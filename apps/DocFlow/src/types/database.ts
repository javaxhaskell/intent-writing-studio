export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never;
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      graphql: {
        Args: {
          extensions?: Json;
          operationName?: string;
          query?: string;
          variables?: Json;
        };
        Returns: Json;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
  public: {
    Tables: {
      document_versions: {
        Row: {
          content: Json;
          content_hash: string;
          created_at: string;
          created_by: string | null;
          document_id: string;
          id: string;
          organization_id: string;
        };
        Insert: {
          content: Json;
          content_hash: string;
          created_at?: string;
          created_by?: string | null;
          document_id: string;
          id?: string;
          organization_id: string;
        };
        Update: {
          content?: Json;
          content_hash?: string;
          created_at?: string;
          created_by?: string | null;
          document_id?: string;
          id?: string;
          organization_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'document_versions_document_id_organization_id_fkey';
            columns: ['document_id', 'organization_id'];
            isOneToOne: false;
            referencedRelation: 'documents';
            referencedColumns: ['id', 'organization_id'];
          },
        ];
      };
      documents: {
        Row: {
          created_at: string;
          deleted_at: string | null;
          id: string;
          kind: string;
          organization_id: string;
          project_id: string;
          title: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          deleted_at?: string | null;
          id?: string;
          kind?: string;
          organization_id: string;
          project_id: string;
          title?: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          deleted_at?: string | null;
          id?: string;
          kind?: string;
          organization_id?: string;
          project_id?: string;
          title?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'documents_project_id_organization_id_fkey';
            columns: ['project_id', 'organization_id'];
            isOneToOne: false;
            referencedRelation: 'projects';
            referencedColumns: ['id', 'organization_id'];
          },
        ];
      };
      organization_members: {
        Row: {
          created_at: string;
          id: string;
          invited_by: string | null;
          organization_id: string;
          role: Database['public']['Enums']['org_role'];
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          invited_by?: string | null;
          organization_id: string;
          role: Database['public']['Enums']['org_role'];
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          invited_by?: string | null;
          organization_id?: string;
          role?: Database['public']['Enums']['org_role'];
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'organization_members_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
        ];
      };
      organizations: {
        Row: {
          created_at: string;
          deleted_at: string | null;
          id: string;
          name: string;
          settings: Json;
          slug: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          deleted_at?: string | null;
          id?: string;
          name: string;
          settings?: Json;
          slug: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          deleted_at?: string | null;
          id?: string;
          name?: string;
          settings?: Json;
          slug?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      projects: {
        Row: {
          created_at: string;
          deleted_at: string | null;
          description: string | null;
          id: string;
          llm_model: string;
          llm_provider: string;
          name: string;
          organization_id: string;
          settings: Json;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          deleted_at?: string | null;
          description?: string | null;
          id?: string;
          llm_model?: string;
          llm_provider?: string;
          name: string;
          organization_id: string;
          settings?: Json;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          deleted_at?: string | null;
          description?: string | null;
          id?: string;
          llm_model?: string;
          llm_provider?: string;
          name?: string;
          organization_id?: string;
          settings?: Json;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'projects_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
        ];
      };
      source_materials: {
        Row: {
          created_at: string;
          deleted_at: string | null;
          id: string;
          injection_scan_status: string;
          mime_type: string;
          organization_id: string;
          project_id: string;
          storage_path: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          deleted_at?: string | null;
          id?: string;
          injection_scan_status?: string;
          mime_type: string;
          organization_id: string;
          project_id: string;
          storage_path: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          deleted_at?: string | null;
          id?: string;
          injection_scan_status?: string;
          mime_type?: string;
          organization_id?: string;
          project_id?: string;
          storage_path?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'source_materials_project_id_organization_id_fkey';
            columns: ['project_id', 'organization_id'];
            isOneToOne: false;
            referencedRelation: 'projects';
            referencedColumns: ['id', 'organization_id'];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      create_document_version: {
        Args: { content: Json; doc_id: string };
        Returns: {
          content: Json;
          content_hash: string;
          created_at: string;
          created_by: string | null;
          document_id: string;
          id: string;
          organization_id: string;
        };
        SetofOptions: {
          from: '*';
          to: 'document_versions';
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      create_organization: {
        Args: { name: string };
        Returns: {
          created_at: string;
          deleted_at: string | null;
          id: string;
          name: string;
          settings: Json;
          slug: string;
          updated_at: string;
        };
        SetofOptions: {
          from: '*';
          to: 'organizations';
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      soft_delete_organization: {
        Args: { org_id: string };
        Returns: {
          created_at: string;
          deleted_at: string | null;
          id: string;
          name: string;
          settings: Json;
          slug: string;
          updated_at: string;
        };
        SetofOptions: {
          from: '*';
          to: 'organizations';
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
    };
    Enums: {
      org_role: 'owner' | 'admin' | 'editor' | 'reviewer' | 'viewer';
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, 'public'>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    ? (DefaultSchema['Tables'] & DefaultSchema['Views'])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema['Tables']
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema['Tables']
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema['Enums']
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums']
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums'][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema['Enums']
    ? DefaultSchema['Enums'][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema['CompositeTypes']
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes']
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes'][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema['CompositeTypes']
    ? DefaultSchema['CompositeTypes'][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      org_role: ['owner', 'admin', 'editor', 'reviewer', 'viewer'],
    },
  },
} as const;
