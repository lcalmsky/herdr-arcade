// Body motion for the arcade characters: only left, top, width and height animate, so nothing
// turns. Every character wears the same motion for its mood; a stall and a sleeper stand still.

const EASE = "ease-in-out";

// Amplitudes in design px from the image box's own corner, periods in ms.
export const MOOD_MOTION = {
  // The hands on the joystick: a short shove sideways and a dip of the whole body.
  working: [
    { prop: "left", from: -2, to: 2, period: 260 },
    { prop: "top", from: 0, to: -2, period: 520 },
  ],
  // One step out of the aisle and a bounce for attention.
  needs: [{ prop: "top", from: 0, to: -4, period: 450 }],
  // A jump next to the machine on a high score.
  done: [{ prop: "top", from: 0, to: -10, period: 700 }],
};

// Loop policies for one character's box. `base` is the image box: left, top, width and height
// in screen px. An empty array means the character stands still.
export function motionLayers(mood, base, scale = 1) {
  return (MOOD_MOTION[mood] ?? []).map((layer) => {
    const anchor = layer.prop === "left" ? base.left : base.top;
    return {
      prop: layer.prop,
      from: anchor + layer.from * scale,
      to: anchor + layer.to * scale,
      period: layer.period,
      easing: EASE,
    };
  });
}

// The walk bob, an alternating rise and squash while a character crosses the floor.
export function walkLayers(base, scale) {
  return [
    { prop: "top", from: base.top, to: base.top - 8 * scale, period: 300, easing: EASE },
    { prop: "height", from: base.height, to: base.height * 0.94, period: 300, easing: EASE },
    { prop: "width", from: base.width, to: base.width * 1.04, period: 300, easing: EASE },
  ];
}

// The carried character sways over the pointer, and the landing squashes once.
export function dragLayers(base, scale) {
  return [
    { prop: "left", from: base.left - 4 * scale, to: base.left + 4 * scale, period: 500, easing: EASE },
    { prop: "height", from: base.height, to: base.height * 1.06, period: 500, easing: EASE },
  ];
}
