# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-02-23

### Added
- ANSI/NIST-ITL EFT parser — Type-1 (transaction), Type-2 (demographics), Type-4 (fingerprint) records
- Pure-JavaScript WSQ decoder ported from [JNBIS](https://github.com/mhshams/jnbis) (Apache 2.0)
- CLI with `info`, `view`, and `export` commands
- WSQ-to-TIFF and WSQ-to-PNG export via Sharp
- Custom error hierarchy — `EftParseError`, `WsqDecodeError`, `ValidationError` extend `EftError`
- TypeScript declarations for all public exports
- CI with GitHub Actions, code coverage with Vitest and Codecov
