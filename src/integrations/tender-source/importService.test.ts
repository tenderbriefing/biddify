import { beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { mapRelease } from "./etendersOcdsAdapter";
import { importOpportunities, syncOpportunity } from "./importService";

const testDb = path.join(process.cwd(), "prisma", "test-phase2.db");
const databaseUrl = `file:${testDb}`;

describe("eTenders import + provenance", () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    // Recreate a dedicated local SQLite file (not production). Avoid prisma --force-reset.
    for (const f of [testDb, `${testDb}-journal`, `${testDb}-wal`, `${testDb}-shm`]) {
      if (fs.existsSync(f)) fs.rmSync(f);
    }
    process.env.DATABASE_URL = databaseUrl;
    execSync("npx prisma db push --skip-generate", {
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: "pipe",
    });
    prisma = new PrismaClient({
      datasources: { db: { url: databaseUrl } },
    });
  });

  it("maps OCDS release with source provenance fields", () => {
    const mapped = mapRelease({
      ocid: "ocds-9t57fa-173573",
      date: "2026-10-09T00:00:00Z",
      buyer: { name: "Johannesburg Water" },
      tender: {
        id: 173573,
        title: "6000080648",
        description: "Supply and Deliver Consumables as per RFQ",
        procurementMethodDetails: "Request for Quotation",
        mainProcurementCategory: "goods",
        tenderPeriod: {
          startDate: "2026-10-09T00:00:00Z",
          endDate: "2026-10-16T12:00:00Z",
        },
        documents: [
          {
            title: "consumables.pdf",
            url: "https://www.etenders.gov.za/home/Download?blobName=x.pdf",
            format: "pdf",
          },
        ],
      },
    });
    expect(mapped).not.toBeNull();
    expect(mapped!.source).toBe("ETENDERS_OCDS");
    expect(mapped!.sourceOpportunityId).toBe("ocds-9t57fa-173573");
    expect(mapped!.sourceUrl).toContain("opportunity?id=173573");
    expect(mapped!.documents).toHaveLength(1);
  });

  it("imports idempotently without duplicating RFQs", async () => {
    const opp = mapRelease({
      ocid: "ocds-9t57fa-173573",
      date: "2026-10-09T00:00:00Z",
      buyer: { name: "Johannesburg Water" },
      tender: {
        id: 173573,
        title: "6000080648",
        description: "Supply and Deliver Consumables as per RFQ to Cydna Lab",
        procurementMethodDetails: "Request for Quotation",
        mainProcurementCategory: "goods",
        tenderPeriod: {
          startDate: "2026-10-09T00:00:00Z",
          endDate: "2026-10-16T12:00:00Z",
        },
        documents: [
          {
            title: "consumables.pdf",
            url: "https://www.etenders.gov.za/home/Download?x",
          },
        ],
      },
    })!;

    const first = await syncOpportunity(prisma, opp);
    expect(first.action).toBe("CREATED");
    expect(first.internalId).toBeTruthy();

    const second = await syncOpportunity(prisma, {
      ...opp,
      title: "6000080648 (updated title from source)",
    });
    expect(second.action).toBe("UPDATED");
    expect(second.rfqId).toBe(first.rfqId);

    const count = await prisma.rfq.count({
      where: {
        source: "ETENDERS_OCDS",
        sourceOpportunityId: "ocds-9t57fa-173573",
      },
    });
    expect(count).toBe(1);

    const stored = await prisma.rfq.findUnique({ where: { id: first.rfqId! } });
    expect(stored?.isRealSource).toBe(true);
    expect(stored?.isDemo).toBe(false);
    expect(stored?.ocid).toBe("ocds-9t57fa-173573");
    expect(stored?.rawSourceMetadata).toBeTruthy();
    expect(stored?.importedAt).toBeTruthy();
    expect(stored?.closingTimeKnown).toBe(true);
    expect(stored?.title).toContain("updated title");
    // Operational status preserved
    expect(stored?.status).toBe("NEW");
  });

  it("batch import respects supply-and-deliver filter + limit", async () => {
    const goods = mapRelease({
      ocid: "ocds-9t57fa-999001",
      buyer: { name: "Demo Buyer" },
      tender: {
        id: 999001,
        title: "Stationery",
        description: "Supply and deliver office stationery",
        procurementMethodDetails: "Request for Quotation",
        mainProcurementCategory: "goods",
        tenderPeriod: { endDate: "2026-10-25T11:00:00Z" },
        documents: [],
      },
    })!;
    const services = mapRelease({
      ocid: "ocds-9t57fa-999002",
      buyer: { name: "Demo Buyer" },
      tender: {
        id: 999002,
        title: "Consulting",
        description: "Appointment of a service provider for advisory consulting",
        procurementMethodDetails: "Request for Quotation",
        mainProcurementCategory: "services",
        tenderPeriod: { endDate: "2026-10-25T11:00:00Z" },
        documents: [],
      },
    })!;

    const result = await importOpportunities(prisma, [services, goods], {
      supplyAndDeliverOnly: true,
      rfqOnly: true,
      limit: 1,
    });
    expect(result.created).toBe(1);
    expect(result.rows[0]?.sourceOpportunityId).toBe("ocds-9t57fa-999001");
  });
});
