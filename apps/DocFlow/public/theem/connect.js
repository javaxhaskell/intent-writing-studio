/**
 * theem ↔ backend connector.
 *
 * Loaded AFTER app.js. app.js keeps owning the aesthetics (modes, sounds,
 * levers, animations); this layer replaces its simulated content and actions
 * with the real backend: Supabase-backed document state and the studio API
 * (/api/studio/*). All model text is inserted via textContent — never HTML.
 */
(() => {
  const qs = new URLSearchParams(window.location.search);
  const DOC_ID = qs.get('doc') || '33333333-3333-4333-8333-333333333333';
  const API = '/api/studio';

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => [...document.querySelectorAll(sel)];

  const toast = $('#regenerationToast');
  const toastTitle = toast.querySelector('strong');
  const toastDetail = toast.querySelector('span');
  const impactPreview = $('#impactPreview');

  let state = null;
  let busy = false;

  // ---------------------------------------------------------------------------
  // Data
  // ---------------------------------------------------------------------------
  async function api(path, init) {
    const res = await fetch(API + path, {
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      ...init,
    });

    if (res.status === 401) {
      const here = window.location.pathname + window.location.search;
      window.location.href = '/auth?redirect_to=' + encodeURIComponent(here);
      throw new Error('unauthenticated');
    }

    if (!res.ok) {
      let detail = '';
      try {
        detail = (await res.json()).error || '';
      } catch (_) {
        /* ignore */
      }
      throw new Error(detail || 'Request failed (' + res.status + ')');
    }

    return res.json();
  }

  const loadState = () => api('/state?documentId=' + encodeURIComponent(DOC_ID));

  // ---------------------------------------------------------------------------
  // Toast helpers (reuse theem's visual language)
  // ---------------------------------------------------------------------------
  function showToast(title, detail) {
    toastTitle.textContent = title;
    toastDetail.textContent = detail;
    toast.classList.add('is-visible');
  }

  const hideToast = () => toast.classList.remove('is-visible');

  function failToast(err) {
    console.error('[theem]', err);
    showToast('That did not go through', String(err.message || err).slice(0, 90));
    setTimeout(hideToast, 4200);
  }

  // ---------------------------------------------------------------------------
  // Hydration
  // ---------------------------------------------------------------------------
  const wordCount = (blocks) =>
    blocks.reduce((n, b) => n + b.content_md.split(/\s+/).filter(Boolean).length, 0);

  const intentById = (id) => state.intents.find((i) => i.id === id);

  function selectedPathway() {
    return state.pathways.find((p) => p.selected) || null;
  }

  function hydrateDocument() {
    const blocks = state.blocks;

    if (!blocks.length) return; // keep the prototype copy until a draft exists

    const chosen = selectedPathway();
    const kicker = $('.kicker');
    const h1 = $('#document h1');
    const dek = $('.dek');
    const body = $('.body-copy');

    if (chosen) {
      h1.textContent = chosen.payload.title;
      dek.textContent = chosen.payload.thesis;
      kicker.textContent =
        'Essay · ' +
        wordCount(blocks) +
        ' words · Pathway 0' +
        (state.pathways.indexOf(chosen) + 1);
    } else {
      h1.textContent = state.document.title;
      kicker.textContent = 'Essay · ' + wordCount(blocks) + ' words';
    }

    body.textContent = '';
    blocks.forEach((b) => {
      const p = document.createElement('p');
      p.className = 'regenerable';
      p.dataset.blockId = b.id;
      const intent = intentById(b.intent_node_id);
      p.dataset.intent = intent ? intent.kind : 'paragraph_goal';
      p.textContent = b.content_md;
      if (b.locked) p.title = 'Locked — never touched by regeneration';
      if (b.freshness === 'stale') p.classList.add('is-affected');
      body.appendChild(p);
    });

    document.title = 'theem — ' + (chosen ? chosen.payload.title : state.document.title);
  }

  function hydrateRibbon() {
    const thesis = state.intents.find((i) => i.kind === 'thesis');
    const tone = state.intents.find((i) => i.kind === 'tone');
    const sections = state.intents.filter((i) => i.kind === 'section_goal');

    const topicCard = $$('.decision-item')[0];

    if (thesis && topicCard) {
      topicCard.querySelector('.decision-value').textContent = thesis.title;
      topicCard.querySelector('p').textContent = thesis.purpose.slice(0, 140);
    }

    const branch = $('.branch-trigger');

    if (sections.length && branch) {
      branch.textContent =
        sections
          .slice(0, 3)
          .map((s) => s.title.split(' ').slice(0, 3).join(' '))
          .join(' → ') + (sections.length > 3 ? ' → …' : '');
    }

    const toneCard = $$('.lever-card')[0];

    if (tone && toneCard) {
      toneCard.querySelector('p').textContent = tone.purpose.slice(0, 120);
    }
  }

  function hydratePathways() {
    const cards = $$('.pathway-card');

    cards.forEach((card, i) => {
      const p = state.pathways[i];

      if (!p) {
        card.style.display = 'none';

        return;
      }

      card.dataset.pathwayId = p.id;
      card.querySelector('.pathway-tag').textContent = (p.payload.tone || 'Route').split(/[,—–.]/)[0].trim().slice(0, 22);
      card.querySelector('h3').textContent = p.payload.title;
      card.querySelector('.paper-content > p:not(.mini-kicker)').textContent =
        p.payload.oneSentenceApproach;
      card.querySelector('.mini-kicker').textContent = 'Route 0' + (i + 1);

      const lis = card.querySelectorAll('ul li');
      const points = [
        (p.payload.structure || []).slice(0, 3).map((s) => s.split(':')[0]).join(' → '),
        p.payload.tone,
        p.payload.endingStrategy,
      ];
      lis.forEach((li, j) => {
        li.textContent = (points[j] || '').slice(0, 90);
      });

      const footerSpan = card.querySelector('footer span');
      footerSpan.textContent = (p.payload.differenceFromOthers || '').slice(0, 64) + '…';

      const isSelected = p.selected;
      card.classList.toggle('is-selected', isSelected);
      card.querySelector('footer button').textContent = isSelected ? 'Selected' : 'Choose';
    });

    // The "filed" tab strip mirrors unselected routes
    const tabs = $$('.file-tabs button');
    const unselected = state.pathways.filter((p) => !p.selected);
    tabs.forEach((tab, i) => {
      if (unselected[i]) tab.textContent = '0' + (state.pathways.indexOf(unselected[i]) + 1);
      else tab.style.display = 'none';
    });
  }

  function hydrateAll() {
    hydrateDocument();
    hydrateRibbon();
    hydratePathways();
  }

  // ---------------------------------------------------------------------------
  // Real actions (capture-phase interception of app.js's simulated handlers)
  // ---------------------------------------------------------------------------
  async function choosePathway(pathwayId) {
    if (busy) return;
    busy = true;
    showToast('Drafting from this pathway', 'Building the intent graph and paragraphs…');
    try {
      await api('/draft', {
        method: 'POST',
        body: JSON.stringify({ documentId: DOC_ID, pathwayId }),
      });
      state = await loadState();
      hydrateAll();
      hideToast();
      const writeButton = document.querySelector('.mode-button[data-mode-target="write"]');
      if (writeButton) writeButton.click();
    } catch (err) {
      failToast(err);
    } finally {
      busy = false;
    }
  }

  function toneIntent() {
    return state.intents.find((i) => i.kind === 'tone') || null;
  }

  function composeTonePurpose() {
    const lever = Number($('#toneLever').value);
    const evidence = Number($('#evidenceLever').value);
    const framing =
      document.querySelector('[data-framing].is-selected')?.dataset.framing || 'Human';
    const toneWord = lever < 35 ? 'measured and calm' : lever < 66 ? 'balanced' : 'urgent and direct';
    const evidenceWord =
      evidence < 35 ? 'light on citations' : evidence < 72 ? 'evidence-led' : 'dense with sources';

    return (
      'Keep the voice ' +
      toneWord +
      ' (' +
      lever +
      '/100 urgency), ' +
      evidenceWord +
      ', framed primarily in ' +
      framing.toLowerCase() +
      ' terms.'
    );
  }

  async function previewImpact() {
    const tone = toneIntent();

    if (!tone) return;
    try {
      const preview = await api('/intent', {
        method: 'POST',
        body: JSON.stringify({
          intentId: tone.id,
          title: tone.title,
          purpose: composeTonePurpose(),
          previewOnly: true,
        }),
      });
      const affected = preview.affectedBlocks.filter((b) => !b.locked).length;
      const lockedOut = preview.affectedBlocks.length - affected;
      impactPreview.querySelector('strong').textContent =
        affected + ' paragraph' + (affected === 1 ? '' : 's') + ' will change';
      impactPreview.querySelector('div > span').textContent =
        lockedOut > 0
          ? lockedOut + ' locked paragraph' + (lockedOut === 1 ? '' : 's') + ' stay fixed.'
          : 'Everything else stays fixed.';
    } catch (_) {
      /* preview text is best-effort; Apply still works */
    }
  }

  async function applyDecisionsForReal() {
    if (busy) return;
    busy = true;
    impactPreview.classList.remove('is-visible');
    showToast('Recasting affected text', 'Only paragraphs tied to the changed intent are rewritten');
    try {
      const tone = toneIntent();

      if (!tone) throw new Error('No tone intent on this document yet — choose a pathway first');

      await api('/intent', {
        method: 'POST',
        body: JSON.stringify({
          intentId: tone.id,
          title: tone.title,
          purpose: composeTonePurpose(),
        }),
      });

      const regen = await api('/regenerate', {
        method: 'POST',
        body: JSON.stringify({ documentId: DOC_ID }),
      });

      // theem's Apply IS the approval step (the impact preview came first),
      // so accept the returned proposals.
      const proposed = (regen.blocks || []).filter((b) => b.freshness === 'proposed');
      for (const b of proposed) {
        await api('/proposal', {
          method: 'POST',
          body: JSON.stringify({ blockId: b.id, decision: 'accept' }),
        });
      }

      state = await loadState();
      hydrateAll();

      $$('.regenerable').forEach((p) => {
        p.classList.remove('is-affected', 'is-ghosting');
        p.classList.add('is-materializing');
        setTimeout(() => p.classList.remove('is-materializing'), 750);
      });
      hideToast();
    } catch (err) {
      failToast(err);
    } finally {
      busy = false;
    }
  }

  // Intercept the prototype's simulated handlers (capture runs first).
  $('#applyDecision').addEventListener(
    'click',
    (event) => {
      event.stopImmediatePropagation();
      applyDecisionsForReal();
    },
    true,
  );

  $('#cancelRegen').addEventListener(
    'click',
    (event) => {
      if (busy) {
        event.stopImmediatePropagation(); // real generation is not cancellable here
      }
    },
    true,
  );

  $$('.pathway-card').forEach((card) => {
    const intercept = (event) => {
      const id = card.dataset.pathwayId;

      if (!id) return; // no backend pathway bound — let the prototype simulate
      event.stopImmediatePropagation();
      event.preventDefault();
      if (!card.classList.contains('is-selected')) choosePathway(id);
    };
    card.querySelector('footer button').addEventListener('click', intercept, true);
    card.addEventListener('dblclick', intercept, true);
  });

  let previewTimer = null;
  ['toneLever', 'evidenceLever'].forEach((id) => {
    $('#' + id).addEventListener('input', () => {
      clearTimeout(previewTimer);
      previewTimer = setTimeout(previewImpact, 600);
    });
  });
  $$('[data-framing]').forEach((b) =>
    b.addEventListener('click', () => {
      clearTimeout(previewTimer);
      previewTimer = setTimeout(previewImpact, 400);
    }),
  );

  // ---------------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------------
  loadState()
    .then((s) => {
      state = s;
      hydrateAll();
    })
    .catch((err) => {
      if (String(err.message) !== 'unauthenticated') failToast(err);
    });
})();
