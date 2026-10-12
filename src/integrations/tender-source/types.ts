/**
 * TenderSourceAdapter boundary.
 * Biddify's RFQ model remains canonical; adapters map source data into it.
 */

export type SourceDocument = {
  id?: string;
  title: string;
  url: string;
  format?: string | null;
  datePublished?: string | null;
};

export type SourceOpportunity = {
  source: string;
  sourceOpportunityId: string;
  ocid?: string | null;
  tenderNumber?: string | null;
  title: string;
  description?: string | null;
  buyer: string;
  department?: string | null;
  category?: string | null;
  mainProcurementCategory?: string | null;
  procurementMethod?: string | null;
  province?: string | null;
  publicationDate?: string | null;
  sourcePublishedAt?: string | null;
  sourceLastModifiedAt?: string | null;
  closingRaw?: string | null;
  briefingDateRaw?: string | null;
  briefingCompulsory?: boolean | null;
  briefingCompulsoryKnown: boolean;
  briefingVenue?: string | null;
  sourceUrl?: string | null;
  documents: SourceDocument[];
  raw: unknown;
};

export type ListOpportunitiesParams = {
  dateFrom: string; // YYYY-MM-DD
  dateTo: string; // YYYY-MM-DD
  pageSize?: number;
  maxPages?: number;
};

export type TenderSourceAdapter = {
  readonly name: string;
  listOpportunities(params: ListOpportunitiesParams): Promise<SourceOpportunity[]>;
  getOpportunity(sourceOpportunityId: string): Promise<SourceOpportunity | null>;
  getDocuments(sourceOpportunityId: string): Promise<SourceDocument[]>;
};
