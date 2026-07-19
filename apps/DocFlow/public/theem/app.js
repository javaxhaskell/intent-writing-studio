(() => {
  'use strict';

  const stages = ['brief', 'beginning', 'middle', 'ending', 'draft'];
  const $ = (id) => document.getElementById(id);
  const views = { brief: $('briefView'), choice: $('choiceView'), draft: $('draftView') };
  const toast = document.getElementById('toast');

  // ---- state --------------------------------------------------------------
  const DEFAULT_INTENTS = {
    beginning:
      'Introduce something the reader recognises, then reveal the hidden contradiction the piece is about.',
    middle:
      'Develop the reasoning and evidence honestly, separating what is known from what is uncertain.',
    ending:
      'Leave the reader with agency: a clear reason to reconsider and a realistic next step.',
  };

  let currentStage = 'brief';
  let brief = null;
  let intents = { ...DEFAULT_INTENTS };
  const options = { beginning: null, middle: null, ending: null };
  const selections = { beginning: null, middle: null, ending: null };
  let draft = null;
  let inFlight = false;

  // ---- backend ------------------------------------------------------------
  async function api(path, payload) {
    const res = await fetch('/api/theem/' + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(payload),
    });

    if (res.status === 401) {
      const here = window.location.pathname + window.location.search;
      window.location.href = '/auth?redirect_to=' + encodeURIComponent(here);
      throw new Error('unauthenticated');
    }

    if (!res.ok) {
      let msg = 'Request failed (' + res.status + ')';
      try {
        msg = (await res.json()).error || msg;
      } catch (_) {
        /* ignore */
      }
      throw new Error(msg);
    }

    return res.json();
  }

  function showToast(title, detail, isError) {
    toast.classList.toggle('is-error', !!isError);
    toast.querySelector('strong').textContent = title;
    toast.querySelector('small').textContent = detail;
    toast.classList.add('is-visible');
  }
  const hideToast = () => toast.classList.remove('is-visible');
  function errorToast(err) {
    console.error('[theem]', err);
    showToast('That step did not go through', String(err.message || err).slice(0, 96), true);
    setTimeout(hideToast, 4600);
  }

  // ---- brief --------------------------------------------------------------
  function readBrief() {
    return {
      coreMessage: $('coreMessage').value.trim(),
      audience: $('audience').value.trim(),
      desiredEffect: $('desiredEffect').value.trim(),
      mustInclude: $('mustInclude').value.trim(),
      mustAvoid: $('mustAvoid').value.trim(),
    };
  }

  const pick = (o) => (o ? { name: o.name, tone: o.tone, summary: o.summary } : null);
  function priorSelections(stage) {
    const out = {};
    if (stage === 'middle' || stage === 'ending') out.beginning = pick(selections.beginning);
    if (stage === 'ending') out.middle = pick(selections.middle);

    return out;
  }

  // ---- stage navigation ---------------------------------------------------
  function setStage(stage) {
    currentStage = stage;
    Object.values(views).forEach((v) => v.classList.remove('is-visible'));
    (stage === 'brief' ? views.brief : stage === 'draft' ? views.draft : views.choice).classList.add(
      'is-visible',
    );
    document.querySelectorAll('.progress-step').forEach((b) => {
      const idx = stages.indexOf(b.dataset.step);
      const cur = stages.indexOf(stage);
      b.classList.toggle('is-active', b.dataset.step === stage);
      b.classList.toggle('is-complete', idx < cur);
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });

    if (['beginning', 'middle', 'ending'].includes(stage)) renderChoices(stage);
    if (stage === 'draft') renderDraft();
  }

  // ---- choices ------------------------------------------------------------
  const STAGE_TITLES = {
    beginning: ['Choose the beginning', 'How should the reader enter the argument?', 'Four openings. Same message, different first experience.'],
    middle: ['Choose the middle', 'How should the case unfold?', 'Four ways to develop the reasoning without losing the reader.'],
    ending: ['Choose the ending', 'What should remain after the final line?', 'Four conclusions. Choose the action, feeling or question the draft leaves behind.'],
  };

  function applyChoiceHeader(stage) {
    const t = STAGE_TITLES[stage];
    $('choiceEyebrow').textContent = t[0];
    $('choiceTitle').textContent = t[1];
    $('choiceSubtitle').textContent = t[2];
    $('sectionIntentLabel').textContent = t[0].replace('Choose the ', '') + ' intent';
    $('sectionIntentInput').value = intents[stage];
  }

  function showChoiceLoading(stage) {
    applyChoiceHeader(stage);
    $('sectionIntentPanel').classList.remove('is-open');
    const grid = $('pathwayGrid');
    grid.classList.add('is-loading');
    grid.innerHTML =
      '<div class="theem-skeleton">Exploring four distinct ' +
      stage +
      's<span class="dot"></span><span class="dot"></span><span class="dot"></span></div>';
    $('selectionStage').textContent = stage[0].toUpperCase() + stage.slice(1) + ' selected';
    $('selectionName').textContent = 'Generating…';
    $('continueButton').disabled = true;
  }

  async function ensureOptions(stage) {
    if (options[stage]) return;
    showChoiceLoading(stage);
    const res = await api('pathways', {
      brief,
      stage,
      intent: intents[stage],
      priorSelections: priorSelections(stage),
    });
    options[stage] = res.options;
  }

  function renderChoices(stage) {
    applyChoiceHeader(stage);
    const list = options[stage];

    if (!list) {
      ensureOptions(stage)
        .then(() => {
          if (currentStage === stage) renderChoices(stage);
        })
        .catch((err) => {
          if (String(err.message) !== 'unauthenticated') errorToast(err);
        });

      return;
    }

    const grid = $('pathwayGrid');
    grid.classList.remove('is-loading');
    grid.innerHTML = list
      .map(
        (_, i) =>
          '<article class="pathway-card" data-index="' +
          i +
          '" tabindex="0">' +
          '<span class="pathway-number">0' +
          (i + 1) +
          '</span>' +
          '<h2></h2><span class="tone-pill"></span>' +
          '<p class="pathway-summary"></p>' +
          '<p class="pathway-label">What this section would say</p>' +
          '<blockquote></blockquote>' +
          '<p class="pathway-label">Movement</p>' +
          '<ol class="pathway-steps"></ol>' +
          '<footer class="pathway-footer"><span></span><button>Select pathway</button></footer>' +
          '</article>',
      )
      .join('');

    // Fill via textContent (never innerHTML) — model output is untrusted.
    [...grid.querySelectorAll('.pathway-card')].forEach((card, i) => {
      const p = list[i];
      if (selections[stage] && selections[stage].name === p.name) card.classList.add('is-selected');
      card.querySelector('h2').textContent = p.name;
      card.querySelector('.tone-pill').textContent = p.tone;
      card.querySelector('.pathway-summary').textContent = p.summary;
      card.querySelector('blockquote').textContent = p.sample;
      const ol = card.querySelector('.pathway-steps');
      p.steps.forEach((s) => {
        const li = document.createElement('li');
        li.textContent = s;
        ol.appendChild(li);
      });
      card.querySelector('.pathway-footer span').textContent = p.match;

      const choose = () => {
        selections[stage] = list[Number(card.dataset.index)];
        if (stage === 'beginning') {
          options.middle = options.ending = null;
          selections.middle = selections.ending = null;
        } else if (stage === 'middle') {
          options.ending = null;
          selections.ending = null;
        }
        draft = null;
        renderChoices(stage);
      };
      card.addEventListener('click', choose);
      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          choose();
        }
      });
    });

    updateSelectionBar(stage);
  }

  function updateSelectionBar(stage) {
    $('selectionStage').textContent = stage[0].toUpperCase() + stage.slice(1) + ' selected';
    $('selectionName').textContent = selections[stage]
      ? selections[stage].name
      : 'Choose one of the four pathways';
    $('continueButton').disabled = !selections[stage];
    $('continueButton').innerHTML =
      stage === 'ending' ? 'Build draft <span>→</span>' : 'Continue <span>→</span>';
  }

  // ---- draft --------------------------------------------------------------
  function paragraphs(text) {
    const frag = document.createDocumentFragment();
    String(text || '')
      .split(/\n{2,}/)
      .map((s) => s.trim())
      .filter(Boolean)
      .forEach((para) => {
        const p = document.createElement('p');
        p.textContent = para;
        frag.appendChild(p);
      });

    return frag;
  }

  async function ensureDraft() {
    if (draft) return;
    showToast('Assembling your draft', 'Weaving the three chosen sections into one piece.');
    draft = await api('draft', {
      brief,
      intents,
      selections: {
        beginning: selections.beginning,
        middle: selections.middle,
        ending: selections.ending,
      },
    });
    hideToast();
  }

  function renderDraft() {
    if (!draft) {
      ensureDraft()
        .then(() => {
          if (currentStage === 'draft') renderDraft();
        })
        .catch((err) => {
          if (String(err.message) !== 'unauthenticated') {
            errorToast(err);
            setStage('ending');
          }
        });

      return;
    }

    $('mapBeginning').textContent = selections.beginning.name;
    $('mapMiddle').textContent = selections.middle.name;
    $('mapEnding').textContent = selections.ending.name;
    $('draftTitle').textContent = draft.title;
    $('draftDek').textContent = draft.dek;

    const setCopy = (id, text) => {
      const node = $(id);
      node.innerHTML = '';
      node.appendChild(paragraphs(text));
    };
    setCopy('beginningCopy', draft.beginning);
    setCopy('middleCopy', draft.middle);
    setCopy('endingCopy', draft.ending);
    document.title = 'theem — ' + draft.title;
    setActiveSection(activeSection || 'beginning');
  }

  // ---- Intent Lens (right-side panel) -------------------------------------
  let activeSection = 'beginning';
  const SECTION_LABEL = { beginning: 'Beginning', middle: 'Middle', ending: 'End' };

  function setActiveSection(section) {
    activeSection = section;
    document.querySelectorAll('.draft-section').forEach((el) =>
      el.classList.toggle('is-active', el.dataset.section === section),
    );
    $('lensTitle').textContent = SECTION_LABEL[section];
    $('lensWhy').textContent = intents[section];
    $('lensPathway').textContent = selections[section] ? selections[section].name : '—';
    $('lensIntentInput').value = intents[section];
  }

  // Streaming section regeneration — text renders live as it generates.
  async function regenerateSection(section) {
    if (inFlight || !draft) return;
    inFlight = true;
    const wrap = $('draft' + section[0].toUpperCase() + section.slice(1));
    const copy = $(section + 'Copy');
    const lensBtn = $('lensRegenerate');

    setActiveSection(section);
    lensBtn.disabled = true;
    lensBtn.textContent = '⚡ Regenerating…';
    wrap.classList.add('is-regenerating');
    copy.innerHTML = '';
    copy.classList.add('is-streaming');

    try {
      const res = await fetch('/api/theem/regenerate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          brief,
          section,
          sectionIntent: intents[section],
          selectionName: selections[section].name,
          currentDraft: {
            title: draft.title,
            beginning: draft.beginning,
            middle: draft.middle,
            ending: draft.ending,
          },
        }),
      });

      if (res.status === 401) {
        const here = window.location.pathname + window.location.search;
        window.location.href = '/auth?redirect_to=' + encodeURIComponent(here);

        return;
      }

      if (!res.ok || !res.body) {
        let msg = 'Request failed (' + res.status + ')';
        try {
          msg = (await res.json()).error || msg;
        } catch (_) {
          /* ignore */
        }
        throw new Error(msg);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let text = '';

      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read();

        if (done) break;
        text += decoder.decode(value, { stream: true });
        // live render: textContent keeps model output inert (no HTML)
        copy.textContent = text;
      }

      draft[section] = text.trim();
      copy.classList.remove('is-streaming');
      copy.innerHTML = '';
      copy.appendChild(paragraphs(text));
    } catch (err) {
      copy.classList.remove('is-streaming');
      if (draft[section]) {
        copy.innerHTML = '';
        copy.appendChild(paragraphs(draft[section]));
      }
      if (String(err.message) !== 'unauthenticated') errorToast(err);
    } finally {
      wrap.classList.remove('is-regenerating');
      lensBtn.disabled = false;
      lensBtn.textContent = '⚡ Save & regenerate section';
      inFlight = false;
    }
  }

  // ---- reset / New --------------------------------------------------------
  function resetAll(clearFields) {
    brief = null;
    intents = { ...DEFAULT_INTENTS };
    options.beginning = options.middle = options.ending = null;
    selections.beginning = selections.middle = selections.ending = null;
    draft = null;
    document.title = 'theem — shape the draft';
    if (clearFields) {
      ['coreMessage', 'audience', 'desiredEffect', 'mustInclude', 'mustAvoid'].forEach((id) => {
        $(id).value = '';
      });
      const dt = document.querySelector('.document-title');
      if (dt) dt.textContent = 'Untitled brief';
      $('draftSpine').textContent = 'Establish → develop → resolve';
    }
    setStage('brief');
    $('coreMessage').focus();
  }

  // ---- events -------------------------------------------------------------
  $('briefForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (inFlight) return;
    const b = readBrief();

    if (!b.coreMessage || !b.audience || !b.desiredEffect) {
      showToast('A little more to go on', 'Fill in core message, audience and desired effect.', true);
      setTimeout(hideToast, 3600);

      return;
    }

    brief = b;
    options.beginning = options.middle = options.ending = null;
    selections.beginning = selections.middle = selections.ending = null;
    draft = null;

    const submitBtn = e.target.querySelector('button[type="submit"]');
    submitBtn.classList.add('is-busy');
    inFlight = true;
    setStage('beginning');
    try {
      await ensureOptions('beginning');
      if (currentStage === 'beginning') renderChoices('beginning');
    } catch (err) {
      if (String(err.message) !== 'unauthenticated') {
        errorToast(err);
        setStage('brief');
      }
    } finally {
      submitBtn.classList.remove('is-busy');
      inFlight = false;
    }
  });

  $('editIntentButton').addEventListener('click', () =>
    $('sectionIntentPanel').classList.toggle('is-open'),
  );

  $('saveSectionIntent').addEventListener('click', () => {
    const stage = currentStage;
    intents[stage] = $('sectionIntentInput').value.trim() || intents[stage];
    $('sectionIntentPanel').classList.remove('is-open');
    options[stage] = null;
    selections[stage] = null;
    if (stage === 'beginning') {
      options.middle = options.ending = null;
      selections.middle = selections.ending = null;
    } else if (stage === 'middle') {
      options.ending = null;
      selections.ending = null;
    }
    draft = null;
    renderChoices(stage);
  });

  $('continueButton').addEventListener('click', async () => {
    if (inFlight) return;
    const next =
      currentStage === 'beginning' ? 'middle' : currentStage === 'middle' ? 'ending' : 'draft';

    if (next === 'draft') {
      inFlight = true;
      try {
        await ensureDraft();
        setStage('draft');
      } catch (err) {
        if (String(err.message) !== 'unauthenticated') errorToast(err);
      } finally {
        inFlight = false;
      }

      return;
    }

    setStage(next);
  });

  $('backButton').addEventListener('click', () =>
    setStage(
      currentStage === 'beginning' ? 'brief' : currentStage === 'middle' ? 'beginning' : 'middle',
    ),
  );
  $('restartButton').addEventListener('click', () => setStage('beginning'));
  $('brandButton').addEventListener('click', () => setStage('brief'));
  $('newButton').addEventListener('click', () => resetAll(true));

  document.querySelectorAll('.progress-step').forEach((b) =>
    b.addEventListener('click', () => {
      const target = b.dataset.step;
      const reachable =
        target === 'brief' ||
        (target === 'beginning' && brief) ||
        (target === 'middle' && selections.beginning) ||
        (target === 'ending' && selections.middle) ||
        (target === 'draft' && draft);
      if (reachable) setStage(target);
    }),
  );

  document.querySelectorAll('.map-item').forEach((x) =>
    x.addEventListener('click', () => $(x.dataset.scroll).scrollIntoView({ behavior: 'smooth' })),
  );

  // Clicking a draft section focuses the Intent Lens on it.
  document.querySelectorAll('.draft-section').forEach((el) =>
    el.addEventListener('click', () => setActiveSection(el.dataset.section)),
  );

  // Lens: save the edited intent and regenerate only the active section.
  $('lensRegenerate').addEventListener('click', () => {
    if (inFlight) return;
    const next = $('lensIntentInput').value.trim();
    if (next) intents[activeSection] = next;
    $('lensWhy').textContent = intents[activeSection];
    regenerateSection(activeSection);
  });

  ['coreMessage', 'desiredEffect'].forEach((id) =>
    $(id).addEventListener('input', () => {
      const message = $('coreMessage').value.toLowerCase();
      $('draftSpine').textContent = /rethink|reconsider|surprising|hidden/.test(message)
        ? 'Surprise → explain → offer agency'
        : 'Establish → develop → resolve';
    }),
  );
})();
