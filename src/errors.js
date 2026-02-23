export class EftError extends Error { name = 'EftError'; }

export class EftParseError extends EftError {
  name = 'EftParseError';
  constructor(message, { offset, recordType } = {}) {
    super(message);
    this.offset = offset ?? null;
    this.recordType = recordType ?? null;
  }
}

export class WsqDecodeError extends EftError {
  name = 'WsqDecodeError';
  constructor(message, { offset } = {}) {
    super(message);
    this.offset = offset ?? null;
  }
}

export class ValidationError extends EftError { name = 'ValidationError'; }
