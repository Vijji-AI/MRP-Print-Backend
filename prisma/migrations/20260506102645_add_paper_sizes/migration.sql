-- CreateTable
CREATE TABLE "PaperSize" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "widthMm" INTEGER NOT NULL,
    "heightMm" INTEGER NOT NULL,
    "isLabel" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaperSize_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PaperSize_customerId_idx" ON "PaperSize"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "PaperSize_customerId_name_key" ON "PaperSize"("customerId", "name");

-- AddForeignKey
ALTER TABLE "PaperSize" ADD CONSTRAINT "PaperSize_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
