(() => {
  const tabs = Array.from(document.querySelectorAll('[role="tab"]'));
  function selectTab(tab, focus = false) {
    tabs.forEach(candidate => {
      const selected = candidate === tab;
      candidate.setAttribute('aria-selected', String(selected));
      candidate.tabIndex = selected ? 0 : -1;
      document.getElementById(candidate.getAttribute('aria-controls')).hidden = !selected;
    });
    if (focus) tab.focus();
  }
  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => selectTab(tab));
    tab.addEventListener('keydown', event => {
      let next = index;
      if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
      else if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = tabs.length - 1;
      else return;
      event.preventDefault(); selectTab(tabs[next], true);
    });
  });
  document.querySelectorAll('[data-open-tab]').forEach(button => button.addEventListener('click', () => {
    const tab = document.getElementById(`tab-${button.dataset.openTab}`);
    selectTab(tab, true); tab.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }));

  const image = document.getElementById('sample-image');
  if (!image) return;
  const N = 48;
  let seed = 384711;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const dataset = Array.from({ length: N }, (_, index) => {
    const col = index % 8, row = Math.floor(index / 8);
    const inLargeFlock = (col >= 1 && col <= 3 && row <= 1) || (col >= 5 && col <= 7 && row >= 3 && row <= 4);
    const onFlockEdge = (col <= 3 && row === 2) || (col >= 4 && row >= 2 && row <= 5 && !inLargeFlock && (col === 4 || row === 5));
    const truth = inLargeFlock ? 4 + Math.floor(random() * 2) : onFlockEdge && random() < .45 ? 2 + Math.floor(random() * 2) : Math.floor(random() * 2);
    const noiseRoll = random();
    const rawPrediction = clamp(truth + (noiseRoll < .24 ? -1 : noiseRoll < .55 ? 1 : 0), 0, 5);
    const samplingPrediction = rawPrediction * .7;
    const prediction = clamp(Math.round(samplingPrediction), 0, 5);
    const samplingScore = samplingPrediction + .35;
    const birds = Array.from({ length: truth }, () => ({ x: 14 + random() * 72, y: 15 + random() * 68, r: -18 + random() * 36 }));
    return { truth, prediction, samplingScore, birds };
  });
  const trueTotal = dataset.reduce((sum, item) => sum + item.truth, 0);
  const aiTotal = dataset.reduce((sum, item) => sum + item.prediction, 0);
  const axisMax = Math.ceil(Math.max(trueTotal, aiTotal, N * 5) / 20) * 20;
  ['axis-max', 'axis-max-2'].forEach(id => document.getElementById(id).textContent = axisMax);
  ['axis-mid', 'axis-mid-2'].forEach(id => document.getElementById(id).textContent = axisMax / 2);
  document.getElementById('ai-estimate').textContent = `${aiTotal} birds`;

  function createBird(bird) {
    const marker = document.createElement('i');
    marker.className = 'bird';
    marker.style.setProperty('--rot', `${bird.r}deg`);
    marker.innerHTML = '<i class="bird-tail"></i><i class="bird-body"></i><i class="bird-wing"></i><i class="bird-neck"></i><i class="bird-head"></i><i class="bird-beak"></i><i class="bird-legs"></i>';
    return marker;
  }

  const sceneBirds = document.getElementById('scene-birds');
  const sceneGrid = document.getElementById('scene-grid');
  const cells = [];
  dataset.forEach((item, index) => {
    const col = index % 8, row = Math.floor(index / 8);
    item.birds.forEach((bird, birdIndex) => {
      const marker = createBird(bird);
      marker.style.left = `${(col + bird.x / 100) / 8 * 100}%`;
      marker.style.top = `${(row + bird.y / 100) / 6 * 100}%`;
      marker.style.setProperty('--rot', `${bird.r}deg`); marker.dataset.cell = index; marker.dataset.bird = birdIndex;
      sceneBirds.appendChild(marker);
    });
    const cell = document.createElement('i'); cell.className = 'scene-cell'; cells.push(cell); sceneGrid.appendChild(cell);
  });

  let tracks, observed, pending, selectedStrategy = null, hasAutoScrolled = false;
  const feedback = document.getElementById('demo-feedback');
  const countButtons = Array.from(document.querySelectorAll('.count-button'));
  const score = (index, method) => method === 'importance' ? dataset[index].samplingScore : 1;
  const rawWeight = stage => stage === N ? 1 : 1 / ((N - stage) * (N - stage + 1));
  function draw(method) {
    const track = tracks[method], used = new Set(track.map(entry => entry.index));
    const available = Array.from({ length: N }, (_, i) => i).filter(i => !used.has(i));
    const remainingWeight = available.reduce((sum, i) => sum + score(i, method), 0);
    let target = Math.random() * remainingWeight, index = available.at(-1);
    for (const candidate of available) { target -= score(candidate, method); if (target < 0) { index = candidate; break; } }
    return { method, index, q: score(index, method) / remainingWeight, remainingWeight };
  }
  function record(sample, value) {
    const track = tracks[sample.method], priorTotal = track.reduce((sum, entry) => sum + entry.value, 0);
    track.push({ ...sample, value, stageTotal: priorTotal + value / sample.q, priorTotal }); observed.set(sample.index, value);
  }
  const currentMethod = () => selectedStrategy || (tracks.uniform.length === tracks.importance.length ? 'uniform' : 'importance');
  const comparisonComplete = () => selectedStrategy ? tracks[selectedStrategy].length >= N : tracks.uniform.length >= N && tracks.importance.length >= N;
  function nextSample() {
    let reused = 0; pending = null;
    while (!comparisonComplete()) {
      const sample = draw(currentMethod());
      if (!observed.has(sample.index)) { pending = sample; break; }
      record(sample, observed.get(sample.index)); reused++;
    }
    renderResults(); renderSample();
    if (reused && pending) feedback.textContent = `Reused ${reused} crop label${reused === 1 ? '' : 's'} requested by both methods.`;
  }
  function renderSample() {
    image.replaceChildren(); cells.forEach((cell, index) => { cell.classList.toggle('labeled', observed.has(index)); cell.classList.toggle('current', pending?.index === index); });
    if (!pending) {
      document.getElementById('strategy-uniform').classList.remove('active'); document.getElementById('strategy-importance').classList.remove('active');
      document.getElementById('sample-number').textContent = '48 / 48 PER METHOD';
      document.getElementById('crop-coordinate').textContent = '—'; image.setAttribute('aria-label', 'All regions sampled'); countButtons.forEach(button => button.disabled = true);
      feedback.textContent = `Both methods now know the exact total: ${trueTotal} birds.`; return;
    }
    const item = dataset[pending.index], stage = tracks[pending.method].length + 1, row = Math.floor(pending.index / 8) + 1, column = pending.index % 8 + 1;
    document.getElementById('strategy-uniform').classList.toggle('active', pending.method === 'uniform');
    document.getElementById('strategy-importance').classList.toggle('active', pending.method === 'importance');
    document.getElementById('sample-number').textContent = `ROUND ${stage} / ${N}`; document.getElementById('crop-coordinate').textContent = `ROW ${row} · COL ${column}`;
    document.getElementById('crop-prediction').textContent = `MODEL PREDICTION: ${item.prediction}`;
    image.setAttribute('aria-label', `Marsh crop with ${item.truth} birds`);
    image.style.backgroundPosition = `${(pending.index % 8) / 7 * 100}% ${Math.floor(pending.index / 8) / 5 * 100}%`;
    item.birds.forEach(bird => { const marker = createBird(bird); marker.style.left = `${bird.x}%`; marker.style.top = `${bird.y}%`; image.appendChild(marker); });
    image.classList.add('enter'); setTimeout(() => image.classList.remove('enter'), 40);
  }
  function combinedTotal(track, n = track.length) {
    if (n === N) return track.reduce((sum, entry) => sum + entry.value, 0);
    let weighted = 0, weightSum = 0;
    for (let i = 0; i < n; i++) { const weight = rawWeight(i + 1); weighted += weight * track[i].stageTotal; weightSum += weight; }
    return weighted / weightSum;
  }
  function uniformMargin(track) {
    const n = track.length, mean = track.reduce((sum, entry) => sum + entry.value, 0) / n;
    const variance = track.reduce((sum, entry) => sum + (entry.value - mean) ** 2, 0) / (n - 1);
    return 1.96 * N * Math.sqrt((1 - n / N) * variance / n);
  }
  function importanceMargin(track) {
    const n = track.length, previousEstimate = combinedTotal(track, n - 1), alphaSum = track.reduce((sum, _, i) => sum + rawWeight(i + 1), 0); let combinedVariance = 0;
    for (let tau = 0; tau < n; tau++) {
      const qTau = index => score(index, 'importance') / track[tau].remainingWeight, remainingEstimate = previousEstimate - track[tau].priorTotal; let knownTerms = 0, varianceWeighted = 0, betaSum = 0;
      for (let r = tau; r < n; r++) { const entry = track[r], proposalAtTau = qTau(entry.index), deviation = entry.value / proposalAtTau - remainingEstimate, varianceEstimate = knownTerms + proposalAtTau / entry.q * deviation ** 2, beta = rawWeight(r + 1); varianceWeighted += beta * varianceEstimate; betaSum += beta; knownTerms += proposalAtTau * deviation ** 2; }
      const alpha = rawWeight(tau + 1) / alphaSum; combinedVariance += alpha ** 2 * varianceWeighted / betaSum;
    }
    return 1.96 * Math.sqrt(Math.max(0, combinedVariance));
  }
  function setInterval(method, estimate, lower, upper) {
    const interval = document.getElementById(`${method}-interval`), point = document.getElementById(`${method}-point`), displayLower = clamp(lower, 0, axisMax), displayUpper = clamp(upper, 0, axisMax);
    interval.style.display = 'block'; interval.style.left = `${displayLower / axisMax * 100}%`; interval.style.width = `${Math.max(0, displayUpper - displayLower) / axisMax * 100}%`; point.style.left = `${clamp((estimate - displayLower) / Math.max(displayUpper - displayLower, .001) * 100, 0, 100)}%`;
  }
  function renderMethod(method) {
    const track = tracks[method], n = track.length, value = document.getElementById(`${method}-estimate`), description = document.getElementById(`${method}-ci`), interval = document.getElementById(`${method}-interval`);
    if (!n) { value.textContent = '—'; description.textContent = 'Label 3 regions to see an approximate 95% confidence interval.'; interval.style.display = 'none'; return; }
    const estimate = combinedTotal(track); value.textContent = Math.round(estimate);
    if (n === N) { description.textContent = `Exact total · all 48 regions sampled`; setInterval(method, estimate, estimate, estimate); return; }
    if (n < 3) { description.textContent = `${n} of 48 regions sampled · interval after 3 labels`; interval.style.display = 'none'; return; }
    const margin = method === 'uniform' ? uniformMargin(track) : importanceMargin(track), lower = estimate - margin, upper = estimate + margin;
    description.innerHTML = `${n} of 48 regions · <strong>95% CI: ${Math.round(lower)}–${Math.round(upper)} birds</strong>`; setInterval(method, estimate, lower, upper);
  }
  function renderResults() {
    renderMethod('uniform'); renderMethod('importance'); const paired = Math.min(tracks.uniform.length, tracks.importance.length);
    document.querySelector('.uniform-card').classList.toggle('strategy-inactive', selectedStrategy === 'importance');
    document.querySelector('.importance-card').classList.toggle('strategy-inactive', selectedStrategy === 'uniform');
    document.getElementById('round-count').textContent = selectedStrategy ? `${tracks[selectedStrategy].length} ${selectedStrategy === 'uniform' ? 'uniform' : 'model-guided'} sample${tracks[selectedStrategy].length === 1 ? '' : 's'}` : `${paired} paired round${paired === 1 ? '' : 's'}`; document.getElementById('unique-count').textContent = `${observed.size} / 48`;
  }
  function reset() { tracks = { uniform: [], importance: [] }; observed = new Map(); countButtons.forEach(button => button.disabled = false); feedback.textContent = 'Choose a count to begin.'; nextSample(); }
  countButtons.forEach(button => button.addEventListener('click', () => {
    if (!pending) return; const value = Number(button.dataset.count);
    record(pending, value); feedback.textContent = 'Crop labeled. The estimates have been updated.'; nextSample();
    if (!hasAutoScrolled) {
      hasAutoScrolled = true;
      requestAnimationFrame(() => document.querySelector('.demo-heading').scrollIntoView({ behavior: 'smooth', block: 'start' }));
    }
  }));
  document.getElementById('reset-demo').addEventListener('click', reset); reset();
  [['uniform', 'strategy-uniform'], ['importance', 'strategy-importance']].forEach(([strategy, id]) => {
    document.getElementById(id).addEventListener('click', () => {
      selectedStrategy = selectedStrategy === strategy ? null : strategy;
      document.getElementById('strategy-uniform').setAttribute('aria-pressed', String(selectedStrategy === 'uniform'));
      document.getElementById('strategy-importance').setAttribute('aria-pressed', String(selectedStrategy === 'importance'));
      reset();
      feedback.textContent = selectedStrategy ? `${selectedStrategy === 'uniform' ? 'Uniform' : 'Model-guided'}-only run started.` : 'Comparison mode started. Methods will alternate.';
    });
  });
})();
