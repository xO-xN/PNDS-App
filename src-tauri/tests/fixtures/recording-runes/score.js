// One composition and monotonic transport per Node process. Coordinates use a
// fixed square so viewport resizing never changes the score or touch space.
import { randomInt, randomUUID } from "node:crypto";

const width = 1000,
  height = 1000;

const animationDuration = 3 * 60 * 1000;
const markAnimationDuration = 8 * 1000; // entrance AND reverse exit
const minimumHold = 1600;
const maximumHold = 3400;

// Each point stays completely empty between consecutive groups.
const earlyEmptyRange = [10000, 16500];
const lateEmptyRange = [9500, 15500];

// Begin with one point; bring others in sooner (all available by 1:08).
const unlockInterval = 8500;
const maxSimultaneousPoints = 5;
const densityStep = 8000; // global active-point allowance grows quickly near the start
const secondElementChance = [0.18, 0.36]; // gradually increases, never > 2 per point

const pointSpacingRatio = 0.32; // 3x3 centered square point matrix

// Pattern sizes are relative to the SHORT SIDE of the viewport, so one number
// is the same fraction of the screen on a phone and on a laptop. Marks no
// longer grow over time: every element is readable and touchable from the
// opening frame, and the occasional large mark can appear immediately.
const commonSizeRatio = [0.22, 0.32]; // 85% of all marks (screen diameter)
const largeSizeRatio = [0.4, 0.6]; // 15%, available from the first second
const largeSizeChance = 0.15;
const patternColors = ["#E63946", "#2A6FBB", "#D98E04", "#2A9D6F"];

// Cross/BigSwirl are rarer because they can visually dominate a point.
const weightedPatterns = [
  "Circle",
  "Swirl",
  "Star",
  "Bubble",
  "Flower",
  "Ridge",
  "Circle",
  "Swirl",
  "Star",
  "Bubble",
  "Flower",
  "Ridge",
  "Cross",
  "BigSwirl",
];

// First six marks are restricted to these three clear silhouettes.
const openingPatterns = ["Swirl", "Circle", "Star", "Swirl", "Star", "Circle"];

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomBetween(rng, low, high) {
  return low + rng() * (high - low);
}

// Every event receives ONE permanent size. Playback and backwards seeking
// never resample it. The distribution is static: the opening is no quieter or
// smaller than the rest of the piece.
function choosePatternSize(rng) {
  const shortSide = Math.min(width, height);
  const [low, high] =
    rng() < largeSizeChance ? largeSizeRatio : commonSizeRatio;
  return randomBetween(rng, shortSide * low, shortSide * high);
}

export function createComposition(compositionSeed) {
  let animationItems;
  let pattern_size;
  const rng = seededRandom(compositionSeed);

  // Square grid regardless of viewport aspect ratio; positions are exact anchors.
  const spacing = Math.min(width, height) * pointSpacingRatio;
  // Only Cross still reads pattern_size: its silhouette keeps its own drawing
  // scale instead of taking the mark's size directly.
  pattern_size = Math.max(14, Math.min(spacing * 0.2, 64));
  const positions = [];

  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      positions.push({
        id: row * 3 + col,
        x: width / 2 + (col - 1) * spacing,
        y: height / 2 + (row - 1) * spacing,
      });
    }
  }

  // Point activation order is randomly selected once, but stays deterministic.
  const activationOrder = [...positions];
  for (let i = activationOrder.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [activationOrder[i], activationOrder[j]] = [
      activationOrder[j],
      activationOrder[i],
    ];
  }

  const candidateGroups = [];

  for (let index = 0; index < activationOrder.length; index++) {
    const point = activationOrder[index];
    const unlockTime = index * unlockInterval;
    // The first point begins immediately. Others enter slightly after unlocking.
    let nextStart =
      unlockTime + (index === 0 ? 0 : randomBetween(rng, 700, 3100));

    while (nextStart < animationDuration) {
      const hold = randomBetween(rng, minimumHold, maximumHold);
      const eventDuration = markAnimationDuration * 2 + hold;
      if (nextStart + eventDuration > animationDuration) break;

      const density = nextStart / animationDuration;
      const probability =
        secondElementChance[0] +
        (secondElementChance[1] - secondElementChance[0]) * density;

      // Exactly one or two elements in a group. Groups never overlap here.
      const allowSecond = nextStart > 12000 && rng() < probability;
      const groupEvents = [makeEvent(point, nextStart, hold, rng)];
      let endOfGroup = groupEvents[0].endTime;

      if (allowSecond) {
        const secondStart = nextStart + randomBetween(rng, 1400, 3100);
        const secondHold = randomBetween(rng, minimumHold, maximumHold);
        if (
          secondStart + markAnimationDuration * 2 + secondHold <=
          animationDuration
        ) {
          groupEvents.push(makeEvent(point, secondStart, secondHold, rng));
          endOfGroup = Math.max(endOfGroup, groupEvents[1].endTime);
        }
      }

      candidateGroups.push({
        pointId: point.id,
        startTime: nextStart,
        endTime: endOfGroup,
        events: groupEvents,
      });

      // Guaranteed blank interval after the LAST element fully disappears.
      const earlyToLate = Math.min(1, endOfGroup / animationDuration);
      const gapMin =
        earlyEmptyRange[0] +
        (lateEmptyRange[0] - earlyEmptyRange[0]) * earlyToLate;
      const gapMax =
        earlyEmptyRange[1] +
        (lateEmptyRange[1] - earlyEmptyRange[1]) * earlyToLate;
      nextStart = endOfGroup + randomBetween(rng, gapMin, gapMax);
    }
  }

  // Reserve the first entrance of all nine points. Later events are optional.
  // This ensures no location is permanently omitted by the global density cap.
  candidateGroups.sort((a, b) => a.startTime - b.startTime);
  const seenPoints = new Set();
  const acceptedGroups = [];
  const optionalGroups = [];
  for (const group of candidateGroups) {
    if (!seenPoints.has(group.pointId)) {
      acceptedGroups.push(group);
      seenPoints.add(group.pointId);
    } else {
      optionalGroups.push(group);
    }
  }

  // Cap the number of active LOCATIONS, NOT individual marks. Groups not
  // selected here simply become longer blank periods at their point.
  for (const group of optionalGroups) {
    const overlaps = acceptedGroups.filter(
      (other) =>
        other.startTime < group.endTime && other.endTime > group.startTime,
    );
    const checkpoints = [
      group.startTime,
      ...overlaps.map((other) => Math.max(other.startTime, group.startTime)),
    ];
    const exceedsLimit = checkpoints.some((time) => {
      const pointLimit = Math.min(
        maxSimultaneousPoints,
        1 + Math.floor(time / densityStep),
      );
      const activeCount = overlaps.filter(
        (other) => other.startTime <= time && other.endTime > time,
      ).length;
      return activeCount >= pointLimit;
    });

    if (!exceedsLimit) acceptedGroups.push(group);
  }

  animationItems = acceptedGroups.flatMap((group) => group.events);
  animationItems.sort((a, b) => a.startTime - b.startTime);

  // Set silhouettes only AFTER accepting and sorting all events, so the
  // first few actually visible marks follow Swirl / Circle / Star.
  for (
    let i = 0;
    i < Math.min(openingPatterns.length, animationItems.length);
    i++
  ) {
    animationItems[i].pattern = openingPatterns[i];
  }
  return Object.freeze({
    seed: compositionSeed,
    duration: animationDuration,
    spacing: width * pointSpacingRatio,
    patternSize: pattern_size,
    items: Object.freeze(
      animationItems.map((item) =>
        Object.freeze({ ...item, point: item.point.id }),
      ),
    ),
  });
}

function makeEvent(point, startTime, holdDuration, rng) {
  const exitStart = startTime + markAnimationDuration + holdDuration;
  const endTime = exitStart + markAnimationDuration;

  return {
    point,
    startTime,
    exitStart,
    endTime,
    seed: Math.floor(rng() * 1_000_000_000),
    pattern: weightedPatterns[Math.floor(rng() * weightedPatterns.length)],
    color: patternColors[Math.floor(rng() * patternColors.length)],
    size: choosePatternSize(rng),
  };
}

export function createScoreSession({
  seed = randomInt(1_000_000_000),
  sessionId = randomUUID(),
  now = () => performance.now(),
} = {}) {
  let composition = createComposition(seed);
  let compositionRevision = 1,
    revision = 0,
    position = 0,
    playing = false,
    sampledAt = now();

  function snapshot() {
    const serverTime = now();
    const playhead = Math.min(
      composition.duration,
      position + (playing ? Math.max(0, serverTime - sampledAt) : 0),
    );
    if (playing && playhead >= composition.duration) {
      position = composition.duration;
      playing = false;
      revision += 1;
    }
    return {
      ...composition,
      sessionId,
      revision,
      compositionRevision,
      hasScore: true,
      playhead,
      playing,
      serverTime,
    };
  }

  function command(payload) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload))
      return null;
    const keys = Object.keys(payload);
    if (
      !keys.length ||
      keys.some((key) => key !== "playing" && key !== "playhead")
    )
      return null;
    if ("playing" in payload && typeof payload.playing !== "boolean")
      return null;
    if (
      "playhead" in payload &&
      (typeof payload.playhead !== "number" ||
        !Number.isFinite(payload.playhead))
    )
      return null;
    const current = snapshot();
    position =
      "playhead" in payload
        ? Math.max(0, Math.min(payload.playhead, composition.duration))
        : current.playhead;
    if ("playing" in payload) {
      playing = payload.playing;
      if (playing && position >= composition.duration) position = 0;
    }
    sampledAt = current.serverTime;
    revision += 1;
    return snapshot();
  }

  function restore(state) {
    if (!state || !Array.isArray(state.items) || state.items.length > 10000 ||
        !Number.isFinite(state.duration) || state.duration <= 0 ||
        !Number.isFinite(state.playhead) || typeof state.playing !== "boolean" ||
        !Number.isFinite(state.spacing) || !Number.isFinite(state.patternSize) ||
        state.items.some(item => !item || !Number.isInteger(item.point) || item.point < 0 || item.point > 8 ||
          !weightedPatterns.includes(item.pattern) || !patternColors.includes(item.color) ||
          ![item.startTime, item.exitStart, item.endTime, item.size, item.seed].every(Number.isFinite) ||
          item.startTime < 0 || item.endTime < item.startTime || item.size <= 0))
      throw new Error("Invalid saved Runes composition");
    compositionRevision += 1;
    composition = { seed: state.seed, duration: state.duration, spacing: state.spacing,
      patternSize: state.patternSize, items: state.items.map(item => ({ ...item })) };
    position = Math.max(0, Math.min(state.playhead, composition.duration));
    playing = state.playing;
    sampledAt = now();
    revision += 1;
    return snapshot();
  }

  return { snapshot, command, restore };
}
