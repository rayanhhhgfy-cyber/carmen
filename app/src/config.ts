import env from '../env.json'; // optional override, ships {"apiBase": ""} by default

/** Base URL of the backend, without a trailing slash. */
export const API_BASE = (env.apiBase || 'http://23.95.128.182:7181').replace(/\/+$/, '');

export const BRAND = 'Carmen';
