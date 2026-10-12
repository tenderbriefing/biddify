import { describe, expect, it } from "vitest";
import { extractJohannesburgWaterBoq, extractRfqDocument } from "./extraction";

const SAMPLE_JW = `
REQUEST FOR QUOTATION
Johannesburg Water SOC Ltd
CYDNA LAB
MATERIAL NUMBERDESCRIPTIONBRAND / EQUIVALENTUNITQUANTITY
1201 DISHWASHING LIQUID 750mlEA 120
1202 TOWEL PAPER 280mm x 1500 metreEA 40
1203 Cotton wool roll 500gEA 60
1204 TOOL BATTERY general purpose penlight 1.5V AA batteryEA 200
1205 Size AAA Duracell batteryEA 150
Notes:
Provide manufacture datasheet and manufacturer names for all items. Failure results in disqualification.
Quotations without brand names where required will not be accepted.
Sample units may be requested before proceeding with order.
Supplier must be registered on Central Supplier Database (CSD).
Complete and sign attached MBD forms.
Submit via e-tender portal etenders.gov.za
Quotation must be on company letterhead
65 Ntemi Piliso Street Newtown
CONTACT PERSON 011 688 1400
VALIDITY 30
CLOSING 16.10.2026 12:00pm
Mthetho
Specific Goals
`;

describe("document extraction", () => {
  it("extracts JW BOQ line items with quantities and specs", () => {
    const result = extractJohannesburgWaterBoq(SAMPLE_JW);
    expect(result.lineItems.length).toBeGreaterThanOrEqual(5);
    expect(result.lineItems.every((l) => l.quantity > 0)).toBe(true);
    expect(result.lineItems.every((l) => l.unit === "EA")).toBe(true);
    expect(result.lineItems.every((l) => l.confidence > 0)).toBe(true);
    const aaa = result.lineItems.find((l) => /AAA/i.test(l.description));
    expect(aaa?.brandRequirement).toBe("Duracell");
    expect(aaa?.equivalentAllowed).toBe(false);
  });

  it("captures mandatory datasheet / CSD / MBD requirements from source", () => {
    const result = extractJohannesburgWaterBoq(SAMPLE_JW);
    expect(result.requirements.some((r) => r.requirementType === "DATASHEET")).toBe(
      true,
    );
    expect(result.requirements.some((r) => r.requirementType === "CSD")).toBe(true);
    expect(result.deliveryDestination).toBe("Cydna Lab");
  });

  it("does not invent line items for unmatched documents", () => {
    const result = extractRfqDocument("Random text with no BOQ", {
      buyer: "Somewhere Else",
    });
    expect(result.lineItems).toEqual([]);
    expect(result.method).toBe("NONE");
  });
});
