import type { LinearRegressionResult } from "./linear-regression-contract";

const numbers = new Intl.NumberFormat("es-PE", { maximumSignificantDigits: 10 });
const percentages = new Intl.NumberFormat("es-PE", { style: "percent", maximumSignificantDigits: 4 });
export const formatRegressionNumber = (value: number) => numbers.format(value);

/** Describes the supplied in-sample metrics; never fits data or calls an LLM. */
export function interpretRegression(result: LinearRegressionResult): string[] {
  const { x, y, slope, r_squared: rSquared, rmse } = result;
  const slopeText = slope === 0
    ? `La pendiente es cero: el valor ajustado de «${y}» se mantiene al variar «${x}».`
    : `Por cada unidad adicional de «${x}», el valor ajustado de «${y}» ${slope > 0 ? "aumenta" : "disminuye"} en ${numbers.format(Math.abs(slope))} ${Math.abs(slope) === 1 ? "unidad" : "unidades"}.`;
  const fitText = rSquared <= 0
    ? `El R² es próximo a cero: el ajuste lineal recoge poca variación de «${y}» en esta muestra.`
    : `El ajuste lineal recoge aproximadamente el ${percentages.format(rSquared)} de la variación observada de «${y}» en esta muestra.`;
  const errorText = rmse === 0
    ? `El RMSE es cero: no se observa error de ajuste en esta muestra dentro de la precisión numérica.`
    : `El RMSE es ${numbers.format(rmse)} ${rmse === 1 ? "unidad" : "unidades"} de «${y}»: resume la magnitud del error de ajuste en estos mismos datos.`;
  return [slopeText, fitText, errorText];
}
