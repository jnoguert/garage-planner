/* Model del vehicle: de les cotes publicades al radi de gir que fa servir el
   planificador.

   El cotxe es un rectangle L x W amb el centre de l'eix posterior com a punt de
   referencia. Tota la cinematica penja de `Rc`, el radi que descriu aquest punt
   amb el volant a fons. */

import fleet from "../data/fleet.json" with { type: "json" };

export const FLEET = fleet.vehicles;
export const TURNING_MEASURES = Object.keys(fleet.turningMeasures);

/* Amplada de via estimada a partir de l'amplada del cos sense retrovisors. */
const trackOf = (W) => Math.max(0.8, W - 0.20);

/* De la xifra de gir publicada a Rc.

   NO hi ha valor per defecte per a `turningMeasure`, i es deliberat: un valor
   per defecte es exactament com s'hi cola l'error. Confondre radi amb diametre
   son 2x, i vorera amb paret son desenes de centimetres — prou perque un
   passadis just doni el resultat contrari al real.

   Vorera a vorera mesura la RODA davantera exterior, a distancia B de l'eix
   posterior i track/2 de l'eix longitudinal:
       Rkerb = sqrt((Rc + track/2)^2 + B^2)
   Paret a paret mesura la CANTONADA davantera exterior de la carrosseria, a
   distancia B+Fo de l'eix posterior i W/2 de l'eix longitudinal:
       Rwall = sqrt((Rc + W/2)^2 + (B+Fo)^2)
   Son formules diferents, no un factor de correccio. */
export function rcFromTurning({ B, W, Fo, turning, turningMeasure }) {
  if (!turningMeasure) {
    throw new Error(`turningMeasure obligatori: una xifra de gir de ${turning} no vol dir res tota sola. Valors: ${TURNING_MEASURES.join(", ")}`);
  }
  let Rc;
  switch (turningMeasure) {
    case "diametre-vorera":
    case "radi-vorera": {
      const Rk = turningMeasure === "radi-vorera" ? turning : turning / 2;
      Rc = Math.sqrt(Math.max(0.01, Rk * Rk - B * B)) - trackOf(W) / 2;
      break;
    }
    case "diametre-paret":
    case "radi-paret": {
      const Rw = turningMeasure === "radi-paret" ? turning : turning / 2;
      const arm = B + Fo;
      Rc = Math.sqrt(Math.max(0.01, Rw * Rw - arm * arm)) - W / 2;
      break;
    }
    default:
      throw new Error(`turningMeasure desconegut: "${turningMeasure}". Valors: ${TURNING_MEASURES.join(", ")}`);
  }
  return Math.max(1.5, Rc);
}

/* Cotes derivades d'una entrada de la biblioteca (o d'una entrada manual amb la
   mateixa forma). Ro es la volada posterior: el que sobra de la llargada un cop
   descomptades la batalla i la volada davantera. */
export function spec(entry) {
  const { L, W, B, Fo } = entry;
  const Ro = Math.max(0.05, L - B - Fo);
  const Rc = rcFromTurning(entry);
  return {
    name: entry.name, id: entry.id,
    L, W, B, Fo, Ro,
    track: trackOf(W),
    Rc,
    dmax: Math.atan(B / Rc),        // angle de direccio maxim
    foEstimated: !!entry.foEstimated,
  };
}

/* Les cotes d'un cotxe de l'escena. `t` es l'index a FLEET; `override` son les
   cotes entrades a ma, i valen NOMES per a aquest cotxe — a diferencia del
   prototip, on editar un camp mutava l'entrada compartida i canviava tots els
   cotxes del mateix model alhora. */
export function specOf(car) {
  return spec(car?.override ?? FLEET[car?.t ?? 0] ?? FLEET[0]);
}
