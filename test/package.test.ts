import * as path from 'node:path';
import { tests } from '@iobroker/testing';

// Validate the package files (package.json, io-package.json, ...)
tests.packageFiles(path.join(__dirname, '..'));
