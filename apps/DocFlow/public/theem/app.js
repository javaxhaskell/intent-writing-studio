(() => {
  const app = document.getElementById('app');
  const writeView = document.getElementById('writeView');
  const pathwayView = document.getElementById('pathwayView');
  const ribbon = document.getElementById('decisionRibbon');
  const modeButtons = [...document.querySelectorAll('[data-mode-target]')];
  const toneLever = document.getElementById('toneLever');
  const evidenceLever = document.getElementById('evidenceLever');
  const toneLabel = document.getElementById('toneLabel');
  const evidenceLabel = document.getElementById('evidenceLabel');
  const impactPreview = document.getElementById('impactPreview');
  const applyDecision = document.getElementById('applyDecision');
  const toast = document.getElementById('regenerationToast');
  const soundToggle = document.getElementById('soundToggle');
  const marginalia = document.getElementById('marginalia');
  const documentNode = document.getElementById('document');
  let currentMode = 'write';
  let soundOn = true;
  let regenTimer = null;
  let audioContext = null;
  let pendingTone = Number(toneLever.value);

  const copy = {
    urgent: {
      opening: 'Every new writing tool promises to remove friction. A cleaner canvas. A faster completion. A sentence before you have fully decided what you mean. Speed feels like progress because it is easy to measure.',
      ending: 'The goal is not to slow writers down. It is to put friction in the right place: before commitment, around consequential choices, and nowhere else. The machine can still move quickly. The writer should remain able to see the path.'
    },
    balanced: {
      opening: 'Writing software has spent decades removing friction: cleaner canvases, faster completion, fewer visible decisions. The gains are real. Yet speed is only one measure of a good writing process.',
      ending: 'Useful friction does not obstruct the writer. It clarifies where a choice deserves attention, then disappears. The machine may move quickly while the author retains a clear view of the route.'
    },
    measured: {
      opening: 'A writing tool can be fast without asking the writer to decide quickly. That distinction matters. Fluency is valuable, but it is not identical to clarity, judgment, or authorship.',
      ending: 'Perhaps the best interface is not the one with the least friction, but the one that places friction carefully. It can preserve momentum while still giving the writer time to recognize a consequential choice.'
    }
  };

  function getAudioContext() {
    if (!audioContext) audioContext = new (window.AudioContext || window.webkitAudioContext)();
    return audioContext;
  }

  function clickSound(pitch = 150, duration = 0.025, volume = 0.03) {
    if (!soundOn) return;
    try {
      const ctx = getAudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(pitch, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(Math.max(60, pitch * .55), ctx.currentTime + duration);
      gain.gain.setValueAtTime(volume, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(.0001, ctx.currentTime + duration);
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + duration);
    } catch (_) {}
  }

  function bellSound() {
    if (!soundOn) return;
    try {
      const ctx = getAudioContext();
      [880, 1320].forEach((frequency, index) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = frequency;
        gain.gain.setValueAtTime(.045 / (index + 1), ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(.0001, ctx.currentTime + .65);
        osc.connect(gain).connect(ctx.destination);
        osc.start(ctx.currentTime + index * .025);
        osc.stop(ctx.currentTime + .7);
      });
    } catch (_) {}
  }

  function setMode(mode) {
    if (!['write', 'decision', 'pathway'].includes(mode)) return;
    currentMode = mode;
    app.classList.remove('mode-write', 'mode-decision', 'mode-pathway');
    app.classList.add(`mode-${mode}`);
    writeView.hidden = mode === 'pathway';
    pathwayView.hidden = mode !== 'pathway';
    ribbon.setAttribute('aria-hidden', mode === 'decision' ? 'false' : 'true');
    modeButtons.forEach((button) => {
      const active = button.dataset.modeTarget === mode;
      button.classList.toggle('is-active', active);
      if (button.classList.contains('mode-button')) button.setAttribute('aria-pressed', String(active));
    });
    clickSound(mode === 'pathway' ? 115 : 145, .035, .025);
  }

  function markDecisionPending() {
    impactPreview.classList.add('is-visible');
    document.querySelectorAll('.regenerable').forEach((p) => p.classList.add('is-affected'));
  }

  function updateLever(input) {
    input.style.setProperty('--value', `${input.value}%`);
  }

  function toneDescriptor(value) {
    if (value < 35) return `${100 - value}% measured`;
    if (value < 66) return 'Balanced';
    return `${value}% urgent`;
  }

  function evidenceDescriptor(value) {
    if (value < 35) return 'Light-touch';
    if (value < 72) return 'Evidence-led';
    return 'Source-dense';
  }

  function regenerate() {
    const affected = [...document.querySelectorAll('.regenerable')];
    impactPreview.classList.remove('is-visible');
    toast.classList.add('is-visible');
    affected.forEach((p) => p.classList.add('is-ghosting'));

    const variant = pendingTone < 35 ? 'measured' : pendingTone < 66 ? 'balanced' : 'urgent';
    clearTimeout(regenTimer);
    regenTimer = setTimeout(() => {
      affected.forEach((p) => {
        p.textContent = copy[variant][p.dataset.intent];
        p.classList.remove('is-ghosting');
        p.classList.add('is-materializing');
        setTimeout(() => p.classList.remove('is-affected', 'is-materializing'), 750);
      });
      toast.classList.remove('is-visible');
      bellSound();
    }, 1050);
  }

  modeButtons.forEach((button) => button.addEventListener('click', () => setMode(button.dataset.modeTarget)));
  document.getElementById('marginHandle').addEventListener('click', () => setMode('decision'));
  document.getElementById('closeRibbon').addEventListener('click', () => setMode('write'));

  toneLever.addEventListener('input', () => {
    pendingTone = Number(toneLever.value);
    updateLever(toneLever);
    toneLabel.textContent = toneDescriptor(pendingTone);
    markDecisionPending();
    clickSound(110 + pendingTone * 1.4, .018, .02);
  });

  evidenceLever.addEventListener('input', () => {
    updateLever(evidenceLever);
    evidenceLabel.textContent = evidenceDescriptor(Number(evidenceLever.value));
    markDecisionPending();
    clickSound(105 + Number(evidenceLever.value), .018, .018);
  });

  document.querySelectorAll('[data-framing]').forEach((button) => {
    button.addEventListener('click', () => {
      document.querySelectorAll('[data-framing]').forEach((b) => b.classList.toggle('is-selected', b === button));
      markDecisionPending();
      clickSound(155, .025, .025);
    });
  });

  const branchTrigger = document.querySelector('.branch-trigger');
  branchTrigger.addEventListener('click', () => {
    branchTrigger.closest('.decision-card').classList.toggle('is-open');
    clickSound(135, .025, .02);
  });
  document.querySelectorAll('[data-structure]').forEach((button) => {
    button.addEventListener('click', () => {
      branchTrigger.textContent = button.dataset.structure;
      branchTrigger.closest('.decision-card').classList.remove('is-open');
      markDecisionPending();
      clickSound(165, .025, .025);
    });
  });

  applyDecision.addEventListener('click', regenerate);
  document.getElementById('cancelRegen').addEventListener('click', () => {
    clearTimeout(regenTimer);
    toast.classList.remove('is-visible');
    document.querySelectorAll('.regenerable').forEach((p) => p.classList.remove('is-affected', 'is-ghosting'));
  });

  soundToggle.addEventListener('click', () => {
    soundOn = !soundOn;
    soundToggle.setAttribute('aria-pressed', String(soundOn));
    soundToggle.title = soundOn ? 'Sound on' : 'Sound off';
    if (soundOn) clickSound(170, .035, .03);
  });

  document.querySelector('.pencil').addEventListener('click', () => marginalia.classList.toggle('is-open'));
  document.getElementById('dismissSuggestion').addEventListener('click', () => marginalia.classList.remove('is-open'));
  document.getElementById('applySuggestion').addEventListener('click', () => {
    toneLever.value = 78;
    pendingTone = 78;
    updateLever(toneLever);
    toneLabel.textContent = toneDescriptor(78);
    marginalia.classList.remove('is-open');
    markDecisionPending();
    setMode('decision');
  });

  document.querySelectorAll('.pathway-card').forEach((card) => {
    const choose = card.querySelector('footer button');
    const select = () => {
      document.querySelectorAll('.pathway-card').forEach((candidate) => {
        const selected = candidate === card;
        candidate.classList.toggle('is-selected', selected);
        candidate.querySelector('footer button').textContent = selected ? 'Selected' : 'Choose';
      });
      clickSound(125, .04, .03);
      setTimeout(bellSound, 80);
    };
    choose.addEventListener('click', (event) => { event.stopPropagation(); select(); });
    card.addEventListener('dblclick', select);
    card.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select(); } });
  });

  documentNode.addEventListener('keydown', (event) => {
    if (event.target.closest('[contenteditable="true"]')) {
      document.body.classList.add('is-typing');
      if (event.key.length === 1 || event.key === 'Backspace' || event.key === 'Enter') clickSound(125 + Math.random() * 45, .02, .018);
    }
  });
  documentNode.addEventListener('keyup', () => setTimeout(() => document.body.classList.remove('is-typing'), 450));

  window.addEventListener('scroll', () => document.body.classList.toggle('has-scrolled', window.scrollY > 8), { passive: true });
  window.addEventListener('keydown', (event) => {
    const mod = event.metaKey || event.ctrlKey;
    if (mod && event.key.toLowerCase() === 'd') { event.preventDefault(); setMode('decision'); }
    if (mod && event.key.toLowerCase() === 'p') { event.preventDefault(); setMode('pathway'); }
    if (mod && event.key.toLowerCase() === 'w') { event.preventDefault(); setMode('write'); }
    if (event.key === 'Escape') setMode('write');
  });

  updateLever(toneLever);
  updateLever(evidenceLever);

  setTimeout(() => marginalia.classList.add('is-open'), 3200);
  setTimeout(() => marginalia.classList.remove('is-open'), 11200);
})();
