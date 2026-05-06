-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "maxDevices" INTEGER NOT NULL DEFAULT 2,
ADD COLUMN     "maxSamples" INTEGER NOT NULL DEFAULT 3;

-- CreateTable
CREATE TABLE "Device" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "userAgent" TEXT,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Device_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Device_customerId_idx" ON "Device"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "Device_customerId_deviceId_key" ON "Device"("customerId", "deviceId");

-- AddForeignKey
ALTER TABLE "Device" ADD CONSTRAINT "Device_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
