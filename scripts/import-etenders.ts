/**
 * Controlled eTenders OCDS pilot import.
 * READ-ONLY against public OCDS. Writes only to local Biddify DB.
 *
 * Usage:
 *   npx tsx scripts/import-etenders.ts --dateFrom=2026-10-05 --dateTo=2026-10-11 --limit=5
 */
import "dotenv/config";
import { prisma } from "../src/lib/db";
import { EtendersOcdsAdapter } from "../src/integrations/tender-source/etendersOcdsAdapter";
import { importOpportunities } from "../src/integrations/tender-source/importService";

function arg(name: string, fallback?: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

async function main() {
  const dateFrom = arg("dateFrom", "2026-10-05")!;
  const dateTo = arg("dateTo", "2026-10-11")!;
  const limit = Number(arg("limit", "5"));

  console.log("Biddify eTenders OCDS import (local write only)");
  console.log({ dateFrom, dateTo, limit, supplyAndDeliverOnly: true });

  const adapter = new EtendersOcdsAdapter();
  const listed = await adapter.listOpportunities({
    dateFrom,
    dateTo,
    pageSize: 50,
    maxPages: 2,
  });

  console.log(`Fetched ${listed.length} OCDS releases`);

  const result = await importOpportunities(prisma, listed, {
    supplyAndDeliverOnly: true,
    rfqOnly: true,
    limit,
  });

  console.log(
    JSON.stringify(
      {
        created: result.created,
        updated: result.updated,
        skipped: result.skipped,
        rows: result.rows,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
