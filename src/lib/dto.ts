// Helpers to project DB rows into the JSON shape the frontend expects.
import type { Customer, Sample, Payment, Settings, PrintRun, Admin, Device } from '@prisma/client';

export const customerDTO = (c: Customer) => {
  // Lazy expiry: if an admin set status='active' but the until-date has passed,
  // project it as 'expired' so the frontend treats them as inactive without
  // needing a background job to flip the row.
  const expired =
    c.subscriptionStatus === 'active' &&
    !!c.subscriptionUntil &&
    c.subscriptionUntil.getTime() < Date.now();
  return {
    id: c.id,
    name: c.name,
    email: c.email,
    organization: c.organization ?? undefined,
    phone: c.phone ?? undefined,
    subscriptionStatus: expired ? 'expired' : c.subscriptionStatus,
    subscriptionUntil: c.subscriptionUntil?.toISOString() ?? undefined,
    totalPrints: c.totalPrints,
    maxSamples: c.maxSamples,
    maxDevices: c.maxDevices,
    createdAt: c.createdAt.toISOString(),
  };
};

export const deviceDTO = (d: Device) => ({
  id: d.id,
  deviceId: d.deviceId,
  userAgent: d.userAgent ?? undefined,
  lastSeenAt: d.lastSeenAt.toISOString(),
  createdAt: d.createdAt.toISOString(),
});

export const adminDTO = (a: Admin) => ({
  id: a.id,
  name: a.name,
  email: a.email,
});

export const sampleDTO = (s: Sample) => ({
  id: s.id,
  customerId: s.customerId,
  name: s.name,
  description: s.description ?? undefined,
  width: s.width,
  height: s.height,
  fields: s.fields as unknown,
  createdAt: s.createdAt.toISOString(),
  updatedAt: s.updatedAt.toISOString(),
});

export const paymentDTO = (p: Payment & { customer?: { name: string } }) => ({
  id: p.id,
  customerId: p.customerId,
  customerName: p.customer?.name ?? '',
  amount: p.amount,
  method: p.method,
  txnRef: p.txnRef,
  status: p.status,
  planMonths: p.planMonths,
  createdAt: p.createdAt.toISOString(),
  verifiedAt: p.verifiedAt?.toISOString() ?? undefined,
});

export const settingsDTO = (s: Settings) => ({
  paperSize: s.paperSize,
  printer: s.printer,
  copies: s.copies,
});

export const printRunDTO = (r: PrintRun) => ({
  id: r.id,
  customerId: r.customerId,
  sampleId: r.sampleId ?? undefined,
  sampleName: r.sampleName,
  labelCount: r.labelCount,
  createdAt: r.createdAt.toISOString(),
});
