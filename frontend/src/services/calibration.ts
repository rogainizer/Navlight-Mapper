import type { CalibrationModel, ControlPoint, ImagePoint } from "../types";

function determinant3(matrix: number[][]): number {
  return (
    matrix[0][0] * (matrix[1][1] * matrix[2][2] - matrix[1][2] * matrix[2][1]) -
    matrix[0][1] * (matrix[1][0] * matrix[2][2] - matrix[1][2] * matrix[2][0]) +
    matrix[0][2] * (matrix[1][0] * matrix[2][1] - matrix[1][1] * matrix[2][0])
  );
}

function solveLinear3(matrix: number[][], vector: number[]): [number, number, number] {
  const denominator = determinant3(matrix);
  if (Math.abs(denominator) < 1e-10) {
    throw new Error("Calibration points do not form a valid transform. Choose points farther apart.");
  }

  const replaceColumn = (index: number): number[][] => {
    const copy = matrix.map((row) => [...row]);
    for (let rowIndex = 0; rowIndex < 3; rowIndex += 1) {
      copy[rowIndex][index] = vector[rowIndex];
    }
    return copy;
  };

  const a = determinant3(replaceColumn(0)) / denominator;
  const b = determinant3(replaceColumn(1)) / denominator;
  const c = determinant3(replaceColumn(2)) / denominator;
  return [a, b, c];
}

export function buildCalibration(controlPoints: [ControlPoint, ControlPoint, ControlPoint]): CalibrationModel {
  const system = controlPoints.map((point) => [point.lat, point.lng, 1]);
  const xVector = controlPoints.map((point) => point.imageX);
  const yVector = controlPoints.map((point) => point.imageY);

  const [a, b, c] = solveLinear3(system, xVector);
  const [d, e, f] = solveLinear3(system, yVector);

  return {
    controlPoints,
    coefficients: [a, b, c, d, e, f]
  };
}

export function geoToImagePoint(
  calibration: CalibrationModel,
  lat: number,
  lng: number
): ImagePoint {
  const [a, b, c, d, e, f] = calibration.coefficients;
  return {
    x: a * lat + b * lng + c,
    y: d * lat + e * lng + f
  };
}

export function imageToGeoPoint(
  calibration: CalibrationModel,
  imageX: number,
  imageY: number
): { lat: number; lng: number } {
  const [a, b, c, d, e, f] = calibration.coefficients;
  const determinant = a * e - b * d;

  if (Math.abs(determinant) < 1e-10) {
    throw new Error("Calibration transform is not invertible. Recalibrate the map.");
  }

  const translatedX = imageX - c;
  const translatedY = imageY - f;

  const lat = (translatedX * e - b * translatedY) / determinant;
  const lng = (a * translatedY - translatedX * d) / determinant;

  return { lat, lng };
}
