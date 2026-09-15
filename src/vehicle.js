/* Vehicle model: from published dimensions to the turning radius the planner
   actually uses.

   A car is an L x W rectangle whose reference point is the centre of the rear
   axle. All the kinematics hang off `Rc`, the radius that point describes at
   full lock. */

import fleet from "../data/fleet.json" with { type: "json" };

export const FLEET = fleet.vehicles;
export const TURNING_MEASURES = Object.keys(fleet.turningMeasures);

/* Track width estimated from the body width excluding mirrors. */
const trackOf = (W) => Math.max(0.8, W - 0.20);

/* From the published turning figure to Rc.

   There is NO default for `turningMeasure`, deliberately: a default is exactly
   how the error sneaks in. Radius vs diameter is a factor of 2, and kerb vs
   wall is tens of centimetres — enough to flip the verdict in a tight aisle.

   Kerb-to-kerb measures the outer front WHEEL, at distance B from the rear
   axle and track/2 from the longitudinal axis:
       Rkerb = sqrt((Rc + track/2)^2 + B^2)
   Wall-to-wall measures the outer front CORNER of the bodywork, at distance
   B+Fo from the rear axle and W/2 from the longitudinal axis:
       Rwall = sqrt((Rc + W/2)^2 + (B+Fo)^2)
   These are different formulas, not a correction factor. */
export function rcFromTurning({ B, W, Fo, turning, turningMeasure }) {
  if (!turningMeasure) {
    throw new Error(`turningMeasure is required: a turning figure of ${turning} means nothing on its own. Values: ${TURNING_MEASURES.join(", ")}`);
  }
  let Rc;
  switch (turningMeasure) {
    case "kerb-diameter":
    case "kerb-radius": {
      const Rk = turningMeasure === "kerb-radius" ? turning : turning / 2;
      Rc = Math.sqrt(Math.max(0.01, Rk * Rk - B * B)) - trackOf(W) / 2;
      break;
    }
    case "wall-diameter":
    case "wall-radius": {
      const Rw = turningMeasure === "wall-radius" ? turning : turning / 2;
      const arm = B + Fo;
      Rc = Math.sqrt(Math.max(0.01, Rw * Rw - arm * arm)) - W / 2;
      break;
    }
    default:
      throw new Error(`unknown turningMeasure: "${turningMeasure}". Values: ${TURNING_MEASURES.join(", ")}`);
  }
  return Math.max(1.5, Rc);
}

/* Dimensions derived from a library entry (or from a hand-entered one with the
   same shape). Ro is the rear overhang: what is left of the length once the
   wheelbase and the front overhang are taken off. */
export function spec(entry) {
  const { L, W, B, Fo } = entry;
  const Ro = Math.max(0.05, L - B - Fo);
  const Rc = rcFromTurning(entry);
  return {
    name: entry.name, id: entry.id,
    L, W, B, Fo, Ro,
    track: trackOf(W),
    Rc,
    dmax: Math.atan(B / Rc),        // maximum steering angle
    foEstimated: !!entry.foEstimated,
  };
}

/* The dimensions of a car in the scene. `t` is the index into FLEET;
   `override` holds hand-entered dimensions and applies to THIS car only —
   unlike the prototype, where editing a field mutated the shared entry and
   changed every car of the same model at once. */
export function specOf(car) {
  return spec(car?.override ?? FLEET[car?.t ?? 0] ?? FLEET[0]);
}
