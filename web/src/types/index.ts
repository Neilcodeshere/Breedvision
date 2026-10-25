/**
 * Domain types for BreedVision.
 *
 * These mirror the intended FastAPI response shapes. When the backend exists,
 * these should be validated against it (or generated from its OpenAPI schema)
 * rather than drifting independently.
 */

export type AnimalCategory = "cattle" | "buffalo";

/** How much the system is willing to assert about a prediction. */
export type ConfidenceBand = "confident" | "uncertain" | "low";

export interface BreedSummary {
  /** Stable slug used in URLs, e.g. "gir". */
  id: string;
  name: string;
  category: AnimalCategory;
  /** Home tract / region of origin. */
  region: string | null;
  shortDescription: string | null;
  imageUrl: string | null;
}

export interface Breed extends BreedSummary {
  description: string | null;
  characteristics: BreedCharacteristic[];
  /** Extra photo URLs shown on the detail page, after the primary image. */
  gallery: string[];
  relatedBreedIds: string[];
  /**
   * Where the breed facts came from (e.g. "ICAR-NBAGR"). Null means unverified
   * and the UI must say so rather than presenting it as established fact.
   */
  source: string | null;
  sourceUrl: string | null;
}

export interface BreedCharacteristic {
  label: string;
  value: string;
}

export interface PredictionAlternative {
  breedId: string;
  breedName: string;
  /** 0..1 */
  probability: number;
}

export interface Prediction {
  /** Highest-probability class. Present even when the band is "low" — the UI
   *  decides how much to assert, not the API. */
  breedId: string;
  breedName: string;
  /** 0..1 */
  confidence: number;
  alternatives: PredictionAlternative[];
  /** Backend's own verdict; the client re-derives a band and should agree. */
  isConfident: boolean;
  /** False when the photo is unlike the cattle photos the model was fitted on.
   *  null/undefined when the model has no such check. When false, no breed is
   *  stated, whatever the confidence number says. */
  looksLikeCattle?: boolean | null;
  modelVersion: string;
  /** Milliseconds of server-side inference, when reported. */
  inferenceMs: number | null;
  /** Normalised bounding box [x, y, w, h] in 0..1, when a detector ran. */
  boundingBox: [number, number, number, number] | null;
}

export interface GeoLocation {
  latitude: number;
  longitude: number;
  /** Metres of horizontal accuracy, when the device reports it. */
  accuracyM: number | null;
}

export interface IdentificationRecord {
  id: string;
  imageUrl: string;
  prediction: Prediction;
  /** ISO 8601. */
  createdAt: string;
  location: GeoLocation | null;
  note: string | null;
}

export type UserRole = "field" | "officer" | "admin";

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  organisation: string | null;
}

export interface ModelInfo {
  version: string;
  architecture: string;
  numClasses: number;
  /** Derived by ml/training/calibrate.py; see lib/confidence.ts for the basis. */
  confidenceThreshold: number;
  trainedAt: string | null;
}

export interface BreedCount {
  breedId: string;
  breedName: string;
  count: number;
}

export interface DashboardStats {
  totalIdentifications: number;
  uncertainIdentifications: number;
  distinctBreeds: number;
  breedDistribution: BreedCount[];
  confidenceHistogram: { bucket: string; count: number }[];
  recentRecords: IdentificationRecord[];
}

/** Discriminated result so callers must handle failure explicitly. */
export type ServiceResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: ServiceError };

export interface ServiceError {
  code:
    | "network"
    | "timeout"
    | "invalid_image"
    | "image_too_large"
    | "unsupported_format"
    | "no_animal_detected"
    | "server"
    | "unauthorised"
    | "unknown";
  /** User-facing sentence: what happened AND what to do next. */
  message: string;
}
