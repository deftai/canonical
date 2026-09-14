#!/usr/bin/env node
import { drainSoftEmits } from "../collection/soft-emit.js";
import { dispatch } from "./dispatch.js";

const code = await dispatch(process.argv.slice(2));
await drainSoftEmits();
process.exit(code);
