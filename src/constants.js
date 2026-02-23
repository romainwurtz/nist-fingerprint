// ANSI/NIST-ITL delimiter bytes
export const FS = 0x1c; // File Separator — separates records
export const GS = 0x1d; // Group Separator — separates fields
export const RS = 0x1e; // Record Separator — separates subfields
export const US = 0x1f; // Unit Separator — separates information items

// Finger position names (ANSI/NIST standard)
export const FINGER_NAMES = {
  1: 'Right Thumb',
  2: 'Right Index',
  3: 'Right Middle',
  4: 'Right Ring',
  5: 'Right Little',
  6: 'Left Thumb',
  7: 'Left Index',
  8: 'Left Middle',
  9: 'Left Ring',
  10: 'Left Little',
  11: 'Plain Right Thumb',
  12: 'Plain Left Thumb',
  13: 'Plain Right Four',
  14: 'Plain Left Four',
};

// Slug aliases for CLI finger selection
export const FINGER_ALIASES = {
  right_thumb: 1,
  right_index: 2,
  right_middle: 3,
  right_ring: 4,
  right_little: 5,
  left_thumb: 6,
  left_index: 7,
  left_middle: 8,
  left_ring: 9,
  left_little: 10,
  plain_right_thumb: 11,
  plain_left_thumb: 12,
  plain_right_four: 13,
  plain_left_four: 14,
};

// File name slugs for export
export const FINGER_SLUGS = {
  1: 'right-thumb',
  2: 'right-index',
  3: 'right-middle',
  4: 'right-ring',
  5: 'right-little',
  6: 'left-thumb',
  7: 'left-index',
  8: 'left-middle',
  9: 'left-ring',
  10: 'left-little',
  11: 'plain-right-thumb',
  12: 'plain-left-thumb',
  13: 'plain-right-four',
  14: 'plain-left-four',
};

// Sex codes (Type-2 field 2.024)
export const SEX_CODES = {
  M: 'Male',
  F: 'Female',
  U: 'Unknown',
};

// Race codes (Type-2 field 2.025)
export const RACE_CODES = {
  W: 'White',
  B: 'Black',
  A: 'Asian',
  I: 'American Indian/Alaskan Native',
  U: 'Unknown',
};

// Eye color codes (Type-2 field 2.031)
export const EYE_COLORS = {
  BLK: 'Black',
  BLU: 'Blue',
  BRO: 'Brown',
  GRY: 'Gray',
  GRN: 'Green',
  HAZ: 'Hazel',
  MAR: 'Maroon',
  MUL: 'Multicolored',
  PNK: 'Pink',
  XXX: 'Unknown',
};

// Hair color codes (Type-2 field 2.032)
export const HAIR_COLORS = {
  BAL: 'Bald',
  BLK: 'Black',
  BLN: 'Blonde',
  BRO: 'Brown',
  GRY: 'Gray',
  RED: 'Red',
  SDY: 'Sandy',
  WHI: 'White',
  XXX: 'Unknown',
};

// Compression type codes (Type-4 CGA byte)
export const COMPRESSION_TYPES = {
  0: 'Uncompressed',
  1: 'WSQ',
  2: 'JPEG',
  3: 'JPEG 2000',
  4: 'JPEG 2000 Lossless',
};

// Impression type codes (Type-4 IMP byte)
export const IMPRESSION_TYPES = {
  0: 'Live-scan plain',
  1: 'Live-scan rolled',
  2: 'Nonlive-scan plain',
  3: 'Nonlive-scan rolled',
  4: 'Latent impression',
  5: 'Latent tracing',
  6: 'Latent photo',
  7: 'Latent lift',
  8: 'Live-scan vertical swipe',
};
