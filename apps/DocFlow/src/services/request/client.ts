/**
 * 客户端请求模块
 * 完整版本，包含：token 认证、SSE、Sentry 上报、重试机制
 * 仅用于浏览器环境
 *
 * 注意：登录会话由 Supabase (@supabase/ssr) 统一管理。本模块不再刷新或写入
 * 任何 legacy auth cookie（auth_token / refresh_token）——401 时仅清理残留
 * 凭证，绝不重新铸造。
 */

'use client';

import * as Sentry from '@sentry/nextjs';
import { createSseStream } from '@azure/core-sse';

import type {
  Method,
  CacheConfig,
  ClientParams,
  ApiResponse,
  RequestResult,
  ErrorHandler,
  RequestOptions,
  RequestParams,
  StreamResponseConfig,
} from './types';
import { RequestError } from './types';

import { getCookie, clearAuthData } from '@/utils/auth/cookie';
import { HTTP_METHODS, HTTP_CREDENTIALS, HTTP_STATUS_MESSAGES } from '@/utils/constants/http';
import { ROUTES } from '@/utils/constants/routes';

// 在开发环境禁止 Sentry 上报和 breadcrumb 记录
const isProduction = process.env.NODE_ENV === 'production';

// 开发环境使用空函数，避免不必要的函数调用开销
const addSentryBreadcrumb = isProduction
  ? (breadcrumb: Parameters<typeof Sentry.addBreadcrumb>[0]) => {
      Sentry.addBreadcrumb(breadcrumb);
    }
  : () => {
      // 开发环境：空操作
    };

const captureSentryException = isProduction
  ? (error: unknown, options?: Parameters<typeof Sentry.captureException>[1]) => {
      Sentry.captureException(error, options as Parameters<typeof Sentry.captureException>[1]);
    }
  : () => {
      // 开发环境：空操作
    };

interface ClientRequestProps {
  url: string;
  method: Method;
  mode?: RequestMode;
  token?: string;
  params?: RequestParams;
  cacheTime?: number;
  timeout?: number;
  retries?: number;
  retryDelay?: number;
  headers?: Record<string, string>;
  withCredentials?: boolean;
  signal?: AbortSignal;
  errorHandler?: ErrorHandler;
}

class ClientRequest {
  private baseURL: string;
  private defaultTimeout: number;
  private defaultRetries: number;
  private defaultRetryDelay: number;

  constructor(baseURL: string, options?: RequestOptions) {
    this.baseURL = baseURL;
    this.defaultTimeout = options?.timeout || 10000;
    this.defaultRetries = options?.retries || 0;
    this.defaultRetryDelay = options?.retryDelay || 1000;
  }

  /**
   * 创建超时 Promise
   */
  private createTimeoutPromise(timeout: number): Promise<never> {
    return new Promise((_, reject) => {
      setTimeout(() => {
        reject(new RequestError('请求超时', '', undefined, 'Timeout'));
      }, timeout);
    });
  }

  /**
   * 统一处理认证失败
   * 仅在受保护页面才跳转登录，公开页面静默清除凭证即可
   */
  private handleAuthFailure(): void {
    clearAuthData();

    if (typeof window === 'undefined') return;

    const { pathname, search } = window.location;

    // 公开路由不触发跳转，避免首页等公开页面被意外重定向
    const isPublicPath =
      pathname === '/' ||
      pathname === ROUTES.AUTH ||
      pathname.startsWith('/auth/') ||
      pathname.startsWith('/blog/') ||
      pathname.startsWith('/share/');

    if (isPublicPath) return;

    const loginUrl = new URL(ROUTES.AUTH, window.location.origin);
    // 让 URLSearchParams 自行编码，避免双重 encodeURIComponent 产生 %252F
    loginUrl.searchParams.set('redirect_to', pathname + search);

    window.location.href = loginUrl.toString();
  }

  /**
   * 构建请求配置
   */
  private buildRequest({
    url,
    method,
    params,
    cacheTime,
    token,
    headers: customHeaders,
    withCredentials,
  }: ClientRequestProps) {
    let queryParams = '';
    let requestPayload: string | FormData | URLSearchParams | undefined;

    const headers: Record<string, string> = { ...customHeaders };

    const authToken = token || getCookie('auth_token');

    if (authToken) {
      headers['Authorization'] = `Bearer ${authToken}`;
    }

    const config: CacheConfig =
      cacheTime !== undefined
        ? cacheTime > 0
          ? { next: { revalidate: cacheTime } }
          : { cache: 'no-store' }
        : { cache: 'no-store' };

    if (method === HTTP_METHODS.GET || method === HTTP_METHODS.DELETE) {
      if (params && !(params instanceof FormData) && !(params instanceof URLSearchParams)) {
        queryParams = new URLSearchParams(
          Object.entries(params)
            .filter(([, v]) => v !== undefined)
            .map(([k, v]) => [k, String(v)]),
        ).toString();
        url = queryParams ? `${url}?${queryParams}` : url;
      }
    } else {
      if (params) {
        if (params instanceof FormData || params instanceof URLSearchParams) {
          requestPayload = params;
        } else {
          headers['Content-Type'] = headers['Content-Type'] || 'application/json';
          requestPayload = JSON.stringify(params);
        }
      }
    }

    return {
      url,
      options: {
        method,
        headers,
        credentials: withCredentials ? HTTP_CREDENTIALS.INCLUDE : HTTP_CREDENTIALS.SAME_ORIGIN,
        body: requestPayload,
        ...config,
      },
    };
  }

  /**
   * 处理响应
   */
  private async handleResponse<T>(res: Response, url: string): Promise<T> {
    const status = res.status;
    const statusText = res.statusText;

    if (!res.ok) {
      let errorMessage = HTTP_STATUS_MESSAGES[status] || `HTTP 错误: ${status} ${statusText}`;
      let errorData = null;

      try {
        const contentType = res.headers.get('content-type');

        if (contentType?.includes('application/json')) {
          errorData = await res.json();

          if (errorData.message) {
            errorMessage = errorData.message;
          }
        } else {
          const textData = await res.text();

          if (textData) {
            errorMessage = textData;
          }
        }
      } catch {
        // 使用默认错误消息
      }

      throw new RequestError(errorMessage, url, status, statusText, errorData);
    }

    const contentType = res.headers.get('content-type');

    if (contentType && !contentType.includes('application/json')) {
      return res as unknown as T;
    }

    try {
      const data = await res.json();

      if (data?.code !== undefined && data.code !== 0 && (data.code < 200 || data.code >= 300)) {
        throw new RequestError(
          data.message || data.reason || '请求失败',
          url,
          status,
          statusText,
          data,
        );
      }

      return data as T;
    } catch (error) {
      if (error instanceof RequestError) {
        throw error;
      }

      throw new RequestError('解析响应数据失败', url, status, statusText);
    }
  }

  /**
   * 执行请求重试
   *
   * 401 不再触发 legacy token 刷新：会话由 Supabase 管理，这里仅清理可能
   * 残留的 legacy cookie 后直接抛出。
   */
  private async executeWithRetry<T>(
    requestFn: () => Promise<T>,
    retries: number,
    retryDelay: number,
  ): Promise<T> {
    try {
      return await requestFn();
    } catch (error) {
      if (error instanceof RequestError && error.status === 401) {
        clearAuthData();
        throw error;
      }

      // 其他错误的重试逻辑
      if (retries > 0) {
        await new Promise((resolve) => setTimeout(resolve, retryDelay));

        return this.executeWithRetry(requestFn, retries - 1, retryDelay);
      }

      throw error;
    }
  }

  /**
   * 统一错误处理函数
   */
  handleRequestError(
    error: unknown,
    fallbackMessage = '请求失败，请稍后重试',
    handlers?: {
      [key: number]: (error: RequestError) => void;
      default?: (error: unknown) => void;
      unauthorized?: () => void;
      forbidden?: () => void;
      serverError?: () => void;
      networkError?: () => void;
    },
  ): string {
    if (error instanceof RequestError) {
      const shouldReportToSentry = error.status !== 401 && error.status !== 404;

      if (shouldReportToSentry) {
        captureSentryException(error, {
          tags: {
            errorType: 'RequestError',
            statusCode: error.status,
            url: error.url,
          },
          contexts: {
            request: {
              url: error.url,
              status: error.status,
              statusText: error.statusText,
            },
            response: {
              data: error.data,
            },
          },
          level: error.status && error.status >= 500 ? 'error' : 'warning',
        });
      }

      if (handlers && error.status) {
        if (handlers[error.status]) {
          handlers[error.status](error);
        } else if (error.status === 401 && handlers.unauthorized) {
          handlers.unauthorized();
        } else if (error.status === 403 && handlers.forbidden) {
          handlers.forbidden();
        } else if (error.status >= 500 && handlers.serverError) {
          handlers.serverError();
        } else if (handlers.default) {
          handlers.default(error);
        }
      } else if (handlers?.default) {
        handlers.default(error);
      }

      return error.message || fallbackMessage;
    }

    if (
      error instanceof TypeError &&
      (error.message.includes('Failed to fetch') ||
        error.message.includes('Network request failed'))
    ) {
      captureSentryException(error, {
        tags: { errorType: 'NetworkError' },
        level: 'error',
      });

      if (handlers?.networkError) {
        handlers.networkError();
      }

      return '网络连接错误，请检查您的网络';
    }

    if (error instanceof DOMException && error.name === 'AbortError') {
      return '请求已取消';
    }

    captureSentryException(error, {
      tags: { errorType: 'UnknownError' },
      level: 'error',
    });

    if (handlers?.default) {
      handlers.default(error);
    }

    return error instanceof Error ? error.message : fallbackMessage;
  }

  /**
   * 包装请求，返回统一结果格式
   */
  private async handleRequest<T>(
    requestFn: () => Promise<ApiResponse<T>>,
    errorHandler?: ErrorHandler,
  ): Promise<RequestResult<T>> {
    try {
      const data = await requestFn();

      return { data, error: null };
    } catch (error) {
      const handlers =
        typeof errorHandler === 'function' ? { default: errorHandler } : errorHandler;

      const errorMessage = this.handleRequestError(error, undefined, {
        ...(handlers as Record<number, (error: RequestError) => void>),
        default: handlers?.default || handlers?.onError,
      });

      if (typeof errorHandler === 'function') {
        errorHandler(error);
      } else if (errorHandler?.onError) {
        errorHandler.onError(error);
      }

      const status = error instanceof RequestError ? error.status : undefined;

      return { data: null, error: errorMessage, status };
    }
  }

  /**
   * 执行 HTTP 请求
   */
  private async execute<T>(props: ClientRequestProps): Promise<T> {
    const {
      url = '',
      params,
      method,
      mode,
      token,
      timeout = this.defaultTimeout,
      retries = this.defaultRetries,
      retryDelay = this.defaultRetryDelay,
      signal,
      cacheTime,
      headers,
      withCredentials,
    } = props;

    const fullUrl = this.baseURL + url;

    addSentryBreadcrumb({
      category: 'http',
      message: `${method} ${fullUrl}`,
      level: 'info',
      data: { url: fullUrl, method, timeout, retries },
    });

    const req = this.buildRequest({
      url: fullUrl,
      method,
      params,
      cacheTime,
      mode,
      token,
      headers,
      withCredentials,
    });

    const makeRequest = async (): Promise<T> => {
      const fetchPromise = fetch(req.url, {
        ...req.options,
        signal,
      } as RequestInit);

      let res: Response;

      if (timeout) {
        res = await Promise.race([fetchPromise, this.createTimeoutPromise(timeout)]);
      } else {
        res = await fetchPromise;
      }

      addSentryBreadcrumb({
        category: 'http',
        message: `${method} ${fullUrl} - ${res.status}`,
        level: 'info',
        data: { url: fullUrl, method, status: res.status, statusText: res.statusText },
      });

      return this.handleResponse<T>(res, fullUrl);
    };

    const requestFn = async () => {
      try {
        return await makeRequest();
      } catch (error) {
        addSentryBreadcrumb({
          category: 'http',
          message: `${method} ${fullUrl} - Failed`,
          level: 'error',
          data: {
            url: fullUrl,
            method,
            error: error instanceof Error ? error.message : 'Unknown error',
          },
        });
        throw error;
      }
    };

    return this.executeWithRetry(requestFn, retries, retryDelay);
  }

  /**
   * 内部请求方法
   */
  private async internalRequest<T>(
    method: Method,
    url: string,
    params?: ClientParams,
    mode?: RequestMode,
    token?: string,
  ): Promise<ApiResponse<T>> {
    return this.execute<ApiResponse<T>>({
      url,
      params: params?.params,
      method,
      mode,
      token,
      cacheTime: params?.cacheTime,
      timeout: params?.timeout,
      retries: params?.retries,
      retryDelay: params?.retryDelay,
      signal: params?.signal,
      headers: params?.headers,
      withCredentials: params?.withCredentials,
    });
  }

  /**
   * GET 请求
   */
  get<T>(
    url: string,
    params?: ClientParams,
    mode?: RequestMode,
    token?: string,
  ): Promise<RequestResult<T>> {
    return this.handleRequest<T>(
      () => this.internalRequest<T>(HTTP_METHODS.GET, url, params, mode, token),
      params?.errorHandler,
    );
  }

  /**
   * POST 请求
   */
  post<T>(
    url: string,
    params?: ClientParams,
    mode?: RequestMode,
    token?: string,
  ): Promise<RequestResult<T>> {
    return this.handleRequest<T>(
      () => this.internalRequest<T>(HTTP_METHODS.POST, url, params, mode, token),
      params?.errorHandler,
    );
  }

  /**
   * PUT 请求
   */
  put<T>(
    url: string,
    params?: ClientParams,
    mode?: RequestMode,
    token?: string,
  ): Promise<RequestResult<T>> {
    return this.handleRequest<T>(
      () => this.internalRequest<T>(HTTP_METHODS.PUT, url, params, mode, token),
      params?.errorHandler,
    );
  }

  /**
   * DELETE 请求
   */
  delete<T>(
    url: string,
    params?: ClientParams,
    mode?: RequestMode,
    token?: string,
  ): Promise<RequestResult<T>> {
    return this.handleRequest<T>(
      () => this.internalRequest<T>(HTTP_METHODS.DELETE, url, params, mode, token),
      params?.errorHandler,
    );
  }

  /**
   * PATCH 请求
   */
  patch<T>(
    url: string,
    params?: ClientParams,
    mode?: RequestMode,
    token?: string,
  ): Promise<RequestResult<T>> {
    return this.handleRequest<T>(
      () => this.internalRequest<T>(HTTP_METHODS.PATCH, url, params, mode, token),
      params?.errorHandler,
    );
  }

  /**
   * SSE 请求（返回原始 Response）
   */
  async sse(
    url: string,
    params: ClientParams,
    callback: (response: Response) => void,
  ): Promise<(() => void) | undefined> {
    const controller = new AbortController();
    const fullUrl = this.baseURL + url;

    addSentryBreadcrumb({
      category: 'sse',
      message: `SSE Connection: ${fullUrl}`,
      level: 'info',
      data: { url: fullUrl, method: 'POST' },
    });

    try {
      const req = this.buildRequest({
        url: fullUrl,
        method: HTTP_METHODS.POST,
        params: params.params,
        headers: params.headers,
        withCredentials: params.withCredentials,
      });

      const response = await fetch(req.url, {
        ...req.options,
        signal: controller.signal,
      } as RequestInit);

      if (!response.ok) {
        // 会话由 Supabase 管理：401 时清理残留 legacy 凭证，不再刷新重试
        if (response.status === 401) {
          this.handleAuthFailure();
        }

        let errorMessage = HTTP_STATUS_MESSAGES[response.status] || 'SSE连接失败';
        let errorData = null;

        try {
          const contentType = response.headers.get('content-type');

          if (contentType?.includes('application/json')) {
            const clonedResponse = response.clone();
            errorData = await clonedResponse.json();

            if (errorData.message) {
              errorMessage = errorData.message;
            }
          }
        } catch {
          // 使用默认错误消息
        }

        const sseError = new RequestError(
          errorMessage,
          fullUrl,
          response.status,
          response.statusText,
          errorData,
        );

        captureSentryException(sseError, {
          tags: { errorType: 'SSEError', statusCode: response.status, url: fullUrl },
          contexts: {
            sse: { url: fullUrl, status: response.status, statusText: response.statusText },
          },
          level: 'error',
        });

        throw sseError;
      }

      addSentryBreadcrumb({
        category: 'sse',
        message: `SSE Connected: ${fullUrl}`,
        level: 'info',
        data: { url: fullUrl, status: response.status },
      });

      callback(response);

      return () => controller.abort();
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        // 中止是预期行为
      } else {
        addSentryBreadcrumb({
          category: 'sse',
          message: `SSE Error: ${fullUrl}`,
          level: 'error',
          data: {
            url: fullUrl,
            error: error instanceof Error ? error.message : 'Unknown error',
          },
        });

        if (!(error instanceof RequestError)) {
          captureSentryException(error, {
            tags: { errorType: 'SSEConnectionError', url: fullUrl },
            contexts: { sse: { url: fullUrl } },
            level: 'error',
          });
        }

        if (typeof params?.errorHandler === 'function') {
          params.errorHandler(error);
        } else if (params?.errorHandler?.onError) {
          params.errorHandler.onError(error);
        }

        throw error;
      }

      throw error;
    }
  }

  /**
   * SSE 流式请求（使用 @azure/core-sse 解析）
   */
  async sseStream(
    url: string,
    params: ClientParams,
    onMessage: (data: { data: string }) => void,
  ): Promise<() => void> {
    const controller = new AbortController();
    const fullUrl = this.baseURL + url;

    addSentryBreadcrumb({
      category: 'sse',
      message: `SSE Stream Connection: ${fullUrl}`,
      level: 'info',
    });

    const connect = async (): Promise<Response> => {
      const req = this.buildRequest({
        url: fullUrl,
        method: HTTP_METHODS.POST,
        params: params.params,
        headers: params.headers,
        withCredentials: params.withCredentials,
      });

      return fetch(req.url, {
        ...req.options,
        signal: controller.signal,
      } as RequestInit);
    };

    const open = async (): Promise<void> => {
      const response = await connect();

      if (!response.ok) {
        // 会话由 Supabase 管理：401 时清理残留 legacy 凭证，不再刷新重试
        if (response.status === 401) {
          this.handleAuthFailure();
        }

        throw new RequestError('SSE连接失败', fullUrl, response.status, response.statusText);
      }

      if (!response.body) {
        throw new RequestError('SSE响应无主体', fullUrl, response.status, response.statusText);
      }

      const stream = createSseStream(response.body);
      const reader = stream.getReader();

      const pump = async () => {
        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;

            if (value && value.data) {
              onMessage(value);
            }
          }
        } catch (err) {
          if (!(err instanceof DOMException && err.name === 'AbortError')) {
            throw err;
          }
        }
      };

      pump().catch((err) => {
        captureSentryException(err, {
          tags: { errorType: 'SSEStreamError', url: fullUrl },
          level: 'error',
        });

        if (typeof params?.errorHandler === 'function') {
          params.errorHandler(err);
        } else if (params?.errorHandler?.onError) {
          params.errorHandler.onError(err);
        }
      });
    };

    open().catch((err) => {
      captureSentryException(err, {
        tags: { errorType: 'SSEOpenError', url: fullUrl },
        level: 'error',
      });

      if (typeof params?.errorHandler === 'function') {
        params.errorHandler(err);
      } else if (params?.errorHandler?.onError) {
        params.errorHandler.onError(err);
      }
    });

    return () => controller.abort();
  }

  /**
   * 通用流式 POST 请求（支持 OpenAI 格式的 SSE 响应）
   *
   * @param url 请求路径
   * @param params 请求参数
   * @param onChunk 接收流式数据块的回调
   * @param config 流式响应配置
   * @returns 取消函数
   */
  async streamPost<T>(
    url: string,
    params: ClientParams,
    onChunk: (chunk: T) => void,
    config?: StreamResponseConfig<T>,
  ): Promise<() => void> {
    const controller = new AbortController();
    const fullUrl = this.baseURL + url;

    addSentryBreadcrumb({
      category: 'stream',
      message: `Stream POST: ${fullUrl}`,
      level: 'info',
      data: { url: fullUrl },
    });

    try {
      const req = this.buildRequest({
        url: fullUrl,
        method: HTTP_METHODS.POST,
        params: params.params,
        headers: params.headers,
        withCredentials: params.withCredentials,
      });

      const response = await fetch(req.url, {
        ...req.options,
        signal: controller.signal,
      } as RequestInit);

      if (!response.ok) {
        let errorMessage = HTTP_STATUS_MESSAGES[response.status] || '流式请求失败';
        let errorData = null;

        try {
          const contentType = response.headers.get('content-type');

          if (contentType?.includes('application/json')) {
            const clonedResponse = response.clone();
            errorData = await clonedResponse.json();

            if (errorData.message) {
              errorMessage = errorData.message;
            }
          }
        } catch {
          // 使用默认错误消息
        }

        const streamError = new RequestError(
          errorMessage,
          fullUrl,
          response.status,
          response.statusText,
          errorData,
        );

        captureSentryException(streamError, {
          tags: { errorType: 'StreamError', statusCode: response.status, url: fullUrl },
          level: 'error',
        });

        // 401 means the session is gone — clear legacy cookies / redirect to login
        if (response.status === 401) {
          this.handleAuthFailure();
        }

        throw streamError;
      }

      // 处理响应头
      if (config?.onHeaders) {
        config.onHeaders(response.headers);
      }

      if (!response.body) {
        throw new RequestError('流式响应无主体', fullUrl, response.status, response.statusText);
      }

      addSentryBreadcrumb({
        category: 'stream',
        message: `Stream connected: ${fullUrl}`,
        level: 'info',
      });

      // 读取流式响应
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      const processStream = async () => {
        try {
          while (true) {
            const { done, value } = await reader.read();

            if (done) {
              if (config?.onDone) {
                config.onDone();
              }

              break;
            }

            buffer += decoder.decode(value, { stream: true });

            const lines = buffer.split('\n');
            buffer = lines.pop() || ''; // 保留不完整的最后一行

            for (const line of lines) {
              if (line.trim() === '') continue;

              let chunk: T | null = null;

              // 如果提供了自定义解析器，使用自定义解析器
              if (config?.parseChunk) {
                chunk = config.parseChunk(line);
              } else {
                // 默认使用 OpenAI 格式解析器
                chunk = this.parseOpenAIStreamLine<T>(line);
              }

              if (chunk) {
                onChunk(chunk);
              }
            }
          }
        } catch (err: any) {
          // Include both DOMException and generic AbortError checks
          if (
            err.name === 'AbortError' ||
            (err instanceof DOMException && err.name === 'AbortError')
          ) {
            return;
          }

          captureSentryException(err, {
            tags: { errorType: 'StreamReadError', url: fullUrl },
            level: 'error',
          });

          if (typeof params?.errorHandler === 'function') {
            params.errorHandler(err);
          } else if (params?.errorHandler?.onError) {
            params.errorHandler.onError(err);
          }
        }
      };

      processStream();

      return () => controller.abort();
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        // 中止是预期行为
      } else {
        addSentryBreadcrumb({
          category: 'stream',
          message: `Stream error: ${fullUrl}`,
          level: 'error',
          data: {
            url: fullUrl,
            error: error instanceof Error ? error.message : 'Unknown error',
          },
        });

        if (!(error instanceof RequestError)) {
          captureSentryException(error, {
            tags: { errorType: 'StreamConnectionError', url: fullUrl },
            level: 'error',
          });
        }

        if (typeof params?.errorHandler === 'function') {
          params.errorHandler(error);
        } else if (params?.errorHandler?.onError) {
          params.errorHandler.onError(error);
        }
      }

      throw error;
    }
  }

  /**
   * 默认的 OpenAI 格式流式响应解析器
   */
  private parseOpenAIStreamLine<T>(line: string): T | null {
    // 处理 data: 开头的行
    if (line.startsWith('data: ')) {
      const jsonStr = line.slice(6);

      if (jsonStr.trim() === '[DONE]') {
        return null;
      }

      try {
        const parsed = JSON.parse(jsonStr);

        return parsed as T;
      } catch (e) {
        // 忽略解析错误
        captureSentryException(e, { extra: { line } });

        return null;
      }
    } else if (
      !line.startsWith('event:') &&
      !line.startsWith('id:') &&
      !line.startsWith('retry:')
    ) {
      // 尝试直接解析非 SSE 格式的 JSON（兼容性处理）
      try {
        const parsed = JSON.parse(line);

        return parsed as T;
      } catch {
        // 忽略解析错误
        return null;
      }
    }

    return null;
  }

  /**
   * 创建取消令牌
   */
  createCancelToken(): { signal: AbortSignal; cancel: (reason?: string) => void } {
    const controller = new AbortController();

    return {
      signal: controller.signal,
      cancel: (reason?: string) => controller.abort(reason),
    };
  }
}

// 创建客户端请求实例
const clientRequest = new ClientRequest(process.env.NEXT_PUBLIC_SERVER_URL || '', {
  timeout: 15000,
  retries: 1,
  retryDelay: 1000,
});

export { ClientRequest, clientRequest };
export default clientRequest;
