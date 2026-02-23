import { describe, it, expect } from 'vitest';
import { EftError, EftParseError, WsqDecodeError, ValidationError } from '../src/errors.js';

describe('Error hierarchy', () => {
  it('EftParseError instanceof EftError', () => {
    expect(new EftParseError('x')).toBeInstanceOf(EftError);
  });

  it('WsqDecodeError instanceof EftError', () => {
    expect(new WsqDecodeError('x')).toBeInstanceOf(EftError);
  });

  it('ValidationError instanceof EftError', () => {
    expect(new ValidationError('x')).toBeInstanceOf(EftError);
  });

  it('all are instanceof Error', () => {
    expect(new EftError('x')).toBeInstanceOf(Error);
    expect(new EftParseError('x')).toBeInstanceOf(Error);
    expect(new WsqDecodeError('x')).toBeInstanceOf(Error);
    expect(new ValidationError('x')).toBeInstanceOf(Error);
  });

  it('generic Error is NOT instanceof EftError', () => {
    expect(new Error('x')).not.toBeInstanceOf(EftError);
  });

  it('.name is correct on each class', () => {
    expect(new EftError('x').name).toBe('EftError');
    expect(new EftParseError('x').name).toBe('EftParseError');
    expect(new WsqDecodeError('x').name).toBe('WsqDecodeError');
    expect(new ValidationError('x').name).toBe('ValidationError');
  });

  it('EftParseError carries context properties', () => {
    const err = new EftParseError('bad', { offset: 42, recordType: 4 });
    expect(err.offset).toBe(42);
    expect(err.recordType).toBe(4);
    expect(err.message).toBe('bad');
  });

  it('WsqDecodeError carries offset', () => {
    const err = new WsqDecodeError('bad', { offset: 99 });
    expect(err.offset).toBe(99);
  });

  it('context defaults to null when omitted', () => {
    const parse = new EftParseError('x');
    expect(parse.offset).toBeNull();
    expect(parse.recordType).toBeNull();

    const wsq = new WsqDecodeError('x');
    expect(wsq.offset).toBeNull();
  });
});
