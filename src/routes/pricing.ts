/**
 * Pricing config — public read, admin write.
 *
 * The config is stored in <project-root>/data/pricing.json so it survives
 * server restarts without any DB migration. A missing file falls back to the
 * DEFAULT_PRICING constants below, which match the original hardcoded values.
 */
import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { z } from 'zod';

const router = Router();

// Resolve relative to the backend root, not the compiled-JS directory.
const DATA_DIR    = path.join(process.cwd(), 'data');
const PRICING_FILE = path.join(DATA_DIR, 'pricing.json');

// ── Default pricing (matches original hardcoded values) ───────────────────────

export const DEFAULT_PRICING: PricingConfig = {
  tiers: [
    { samples: 3,  yearlyPrice: 3000,  label: '3',   badge: '' },
    { samples: 5,  yearlyPrice: 4000,  label: '5',   badge: 'Popular' },
    { samples: 10, yearlyPrice: 6000,  label: '10',  badge: '' },
    { samples: 25, yearlyPrice: 8000,  label: '25',  badge: '5% yearly' },
    { samples: 50, yearlyPrice: 10000, label: '50',  badge: '5% yearly' },
    { samples: 99, yearlyPrice: 13000, label: '50+', badge: 'Enterprise · 5% yearly' },
  ],
  deviceBase:      2,
  deviceExtra:     50,
  discountPercent: 5,
  discountTiers:   [25, 50, 99],
};

export interface PricingTier {
  samples:     number;
  yearlyPrice: number;
  label:       string;
  badge:       string;
}

export interface PricingConfig {
  tiers:           PricingTier[];
  deviceBase:      number;
  deviceExtra:     number;
  discountPercent: number;
  discountTiers:   number[];
}

// ── File helpers ──────────────────────────────────────────────────────────────

export function readPricing(): PricingConfig {
  try {
    const raw = fs.readFileSync(PRICING_FILE, 'utf8');
    return JSON.parse(raw) as PricingConfig;
  } catch {
    return DEFAULT_PRICING;
  }
}

export function writePricing(data: PricingConfig): void {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(PRICING_FILE, JSON.stringify(data, null, 2));
}

// ── Zod schemas (exported so admin.ts can reuse) ──────────────────────────────

export const pricingTierSchema = z.object({
  samples:     z.number().int().min(1).max(10000),
  yearlyPrice: z.number().int().min(0).max(10_000_000),
  label:       z.string().min(1).max(20),
  badge:       z.string().max(60),
});

export const pricingSchema = z.object({
  tiers:           z.array(pricingTierSchema).min(1).max(20),
  deviceBase:      z.number().int().min(0).max(99),
  deviceExtra:     z.number().int().min(0).max(100_000),
  discountPercent: z.number().min(0).max(100),
  discountTiers:   z.array(z.number().int().min(1)),
});

// ── Public route: GET /api/pricing ────────────────────────────────────────────

router.get('/', (_req, res) => {
  res.json(readPricing());
});

export default router;
