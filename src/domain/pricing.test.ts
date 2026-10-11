import { describe, expect, it } from "vitest";
import {
  applyMarkup,
  applyVatTreatment,
  calculateGrossMarginPercent,
  calculateGrossProfit,
  calculateLandedCost,
  calculatePricing,
  priceLineItem,
} from "./pricing";

describe("pricing engine", () => {
  it("applies markup on cost (not margin) correctly", () => {
    const { markupAmount, sellingPriceExVat } = applyMarkup(100_000, 20);
    expect(markupAmount).toBe(20_000);
    expect(sellingPriceExVat).toBe(120_000);
  });

  it("distinguishes gross profit from gross margin", () => {
    const gp = calculateGrossProfit(120_000, 100_000);
    const margin = calculateGrossMarginPercent(gp, 120_000);
    expect(gp).toBe(20_000);
    expect(margin).toBe(16.67);
  });

  it("never adds VAT when company is not VAT registered", () => {
    const result = calculatePricing({
      supplierCost: 100_000,
      markupPercent: 20,
      vatRegistered: false,
    });
    expect(result.vatAmount).toBe(0);
    expect(result.totalQuotation).toBe(120_000);
    expect(result.vatRegistered).toBe(false);
  });

  it("applies VAT only when company is VAT registered", () => {
    const result = calculatePricing({
      supplierCost: 100_000,
      markupPercent: 20,
      vatRegistered: true,
      vatRatePercent: 15,
    });
    expect(result.sellingPriceExVat).toBe(120_000);
    expect(result.vatAmount).toBe(18_000);
    expect(result.totalQuotation).toBe(138_000);
  });

  it("includes direct costs in landed cost before markup", () => {
    const landed = calculateLandedCost({
      supplierCost: 100_000,
      delivery: 2_000,
      logistics: 500,
      packaging: 200,
      insurance: 100,
      financing: 300,
      contingency: 400,
      otherDirectCosts: 500,
    });
    expect(landed).toBe(104_000);

    const priced = calculatePricing({
      supplierCost: 100_000,
      delivery: 2_000,
      logistics: 500,
      packaging: 200,
      insurance: 100,
      financing: 300,
      contingency: 400,
      otherDirectCosts: 500,
      markupPercent: 20,
      vatRegistered: false,
    });
    expect(priced.landedCost).toBe(104_000);
    expect(priced.sellingPriceExVat).toBe(124_800);
    expect(priced.grossProfit).toBe(20_800);
  });

  it("does not apply a blind default markup — caller must supply markupPercent", () => {
    const a = calculatePricing({
      supplierCost: 50_000,
      markupPercent: 10,
      vatRegistered: false,
    });
    const b = calculatePricing({
      supplierCost: 50_000,
      markupPercent: 25,
      vatRegistered: false,
    });
    expect(a.sellingPriceExVat).toBe(55_000);
    expect(b.sellingPriceExVat).toBe(62_500);
  });

  it("prices line items with markup on line cost", () => {
    const line = priceLineItem({ quantity: 10, unitCost: 100 }, 20);
    expect(line.lineCost).toBe(1_000);
    expect(line.lineSell).toBe(1_200);
    expect(line.unitSell).toBe(120);
  });

  it("VAT helper rejects ambiguous usage by requiring boolean", () => {
    const noVat = applyVatTreatment(1_000, false);
    expect(noVat.vatAmount).toBe(0);
    expect(noVat.totalQuotation).toBe(1_000);
  });

  it("tracks working capital requirement separately from profit", () => {
    const result = calculatePricing({
      supplierCost: 400_000,
      markupPercent: 20,
      vatRegistered: false,
      workingCapitalRequired: 400_000,
    });
    expect(result.workingCapitalRequired).toBe(400_000);
    expect(result.grossProfit).toBe(80_000);
  });
});
