import type { ProductOption } from "./types.js";

export const PRODUCT_NAME = "BT Lockers";

export const PRODUCTS: ProductOption[] = [
  straight("Straight 1", 1, 1, 333, 200, 133),
  straight("Straight 2", 2, 2, 667, 400, 267),
  straight("Straight 3", 3, 3, 1000, 600, 400),
  straight("Straight 4", 4, 4, 1333, 800, 533),
  straight("Straight 5", 5, 5, 1667, 1000, 667),
  straight("Straight 6", 6, 6, 2000, 1200, 800),
  straight("Straight 8", 8, 8, 2500, 1500, 1000),
  straight("Straight 10", 10, 10, 3000, 1800, 1200),
  straight("Straight 12", 12, 12, 3500, 2100, 1400),
  straight("Straight 15", 15, 15, 4250, 2550, 1700),
  straight("Straight 20", 20, 20, 5500, 3300, 2200),
  l("L 2x2", 4, 2, 2, 1333, 800, 533),
  l("L 3x2", 5, 3, 2, 1667, 1000, 667),
  l("L 3x3", 6, 3, 3, 2000, 1200, 800),
  l("L 4x2", 6, 4, 2, 2000, 1200, 800),
  l("L 4x3", 7, 4, 3, 2250, 1350, 900),
  l("L 4x4", 8, 4, 4, 2500, 1500, 1000),
  l("L 5x3", 8, 5, 3, 2500, 1500, 1000),
  l("L 6x3", 9, 6, 3, 2750, 1650, 1100),
  l("L 6x4", 10, 6, 4, 3000, 1800, 1200),
  l("L 8x4", 12, 8, 4, 3500, 2100, 1400),
  l("L 10x5", 15, 10, 5, 4250, 2550, 1700),
  l("L 10x10", 20, 10, 10, 5500, 3300, 2200)
];

function straight(
  product: string,
  modules: number,
  lengthM: number,
  totalRevenueYear: number,
  paidToSpaceOwnerYear: number,
  biffenRevenueYear: number
): ProductOption {
  return {
    product,
    family: "straight",
    modules,
    totalMetres: lengthM,
    footprintLengthM: lengthM,
    footprintDepthM: 0.8,
    heightM: 2.2,
    sizeLabel: `${lengthM}m x 0.8m x 2.2m`,
    totalRevenueYear,
    paidToSpaceOwnerYear,
    biffenRevenueYear
  };
}

function l(
  product: string,
  totalMetres: number,
  lengthM: number,
  depthM: number,
  totalRevenueYear: number,
  paidToSpaceOwnerYear: number,
  biffenRevenueYear: number
): ProductOption {
  return {
    product,
    family: "l",
    modules: totalMetres,
    totalMetres,
    footprintLengthM: lengthM,
    footprintDepthM: depthM,
    heightM: 2.2,
    sizeLabel: `${lengthM}m x ${depthM}m x 2.2m`,
    totalRevenueYear,
    paidToSpaceOwnerYear,
    biffenRevenueYear
  };
}

export function printProductMatrix(): void {
  const rows = PRODUCTS.map((product) => ({
    product: product.product,
    layout: product.family === "straight" ? `${product.modules} modules` : "L layout",
    size: product.sizeLabel,
    total: formatGbp(product.totalRevenueYear),
    owner: formatGbp(product.paidToSpaceOwnerYear),
    biffen: formatGbp(product.biffenRevenueYear)
  }));

  console.table(rows);
}

export function formatGbp(value: number): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits: 0
  }).format(value);
}
