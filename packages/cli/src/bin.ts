#!/usr/bin/env node
import { main } from './main.js';

main(process.argv).catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`terrarium: ${message}`);
  process.exit(1);
});
