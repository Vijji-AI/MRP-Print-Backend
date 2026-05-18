-- CreateTable
CREATE TABLE "SubscriptionRequest" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "maxSamples" INTEGER NOT NULL,
    "maxDevices" INTEGER NOT NULL,
    "planMonths" INTEGER NOT NULL,
    "note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubscriptionRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SubscriptionRequest_customerId_idx" ON "SubscriptionRequest"("customerId");

-- CreateIndex
CREATE INDEX "SubscriptionRequest_status_idx" ON "SubscriptionRequest"("status");

-- AddForeignKey
ALTER TABLE "SubscriptionRequest" ADD CONSTRAINT "SubscriptionRequest_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
