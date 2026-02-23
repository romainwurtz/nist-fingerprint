// --- Error Classes ---

export class EftError extends Error {
  name: 'EftError';
}

export class EftParseError extends EftError {
  name: 'EftParseError';
  offset: number | null;
  recordType: number | null;
  constructor(message: string, options?: { offset?: number; recordType?: number });
}

export class WsqDecodeError extends EftError {
  name: 'WsqDecodeError';
  offset: number | null;
  constructor(message: string, options?: { offset?: number });
}

export class ValidationError extends EftError {
  name: 'ValidationError';
}

// --- Interfaces ---

export interface ParsedDate {
  year: number;
  month: number;
  day: number;
}

export interface SubjectName {
  first: string;
  middle: string;
  last: string;
}

export interface Scanner {
  make: string;
  model: string;
  serial: string;
}

export interface Type2Demographics {
  raw: Record<string, string>;
  name: SubjectName | null;
  fullName: string | null;
  dob: ParsedDate | null;
  sex: string | null;
  race: string | null;
  height: string | null;
  weight: number | null;
  eyeColor: string | null;
  hairColor: string | null;
  purpose: string | null;
  dateCaptured: ParsedDate | null;
  address: string | null;
  scanner: Scanner | null;
}

export interface Type4Record {
  length: number;
  idc: number;
  impressionType: number;
  impressionName: string;
  fingerPosition: number;
  fingerName: string;
  ppi: number;
  width: number;
  height: number;
  compression: number;
  compressionName: string;
  imageData: Uint8Array;
}

export interface EftFile {
  type1: Record<string, string>;
  type2: Type2Demographics;
  type4Records: Type4Record[];
  fileSize: number;
}

export interface DecodedImage {
  width: number;
  height: number;
  pixels: Uint8Array;
}

// --- Functions ---

export function parseEft(buf: Buffer | Uint8Array): EftFile;
export function decodeWsq(data: Buffer | Uint8Array): DecodedImage;
export function toTiff(pixels: Uint8Array, width: number, height: number, ppi?: number): Promise<Buffer>;
export function toPng(pixels: Uint8Array, width: number, height: number): Promise<Buffer>;
export function exportFilename(fingerPosition: number, format?: string): string;
export function formatDate(dateObj: ParsedDate | null | undefined): string;
export function titleCase(str: string): string;
export function resolveFingerPosition(finger: string | null | undefined): number | null;
export function filterRecords(records: Type4Record[], fingerOpt?: string | null): Type4Record[];
export function formatHeight(heightStr: string | null | undefined): string | null | undefined;

// --- Constants ---

export const FINGER_NAMES: Record<number, string>;
export const FINGER_ALIASES: Record<string, number>;
export const FINGER_SLUGS: Record<number, string>;
export const SEX_CODES: Record<string, string>;
export const RACE_CODES: Record<string, string>;
export const EYE_COLORS: Record<string, string>;
export const HAIR_COLORS: Record<string, string>;
export const COMPRESSION_TYPES: Record<number, string>;
export const IMPRESSION_TYPES: Record<number, string>;

export const FS: number;
export const GS: number;
export const RS: number;
export const US: number;
