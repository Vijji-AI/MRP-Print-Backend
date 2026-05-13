-- AlterTable: add allowPdf column to Customer
ALTER TABLE "Customer" ADD COLUMN "allowPdf" BOOLEAN NOT NULL DEFAULT false;
