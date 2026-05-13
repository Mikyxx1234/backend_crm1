-- CreateTable
CREATE TABLE "mobile_layout_config" (
    "id" TEXT NOT NULL,
    "bottomNavModuleIds" TEXT NOT NULL DEFAULT 'inbox,pipeline,tasks,contacts',
    "enabledModuleIds" TEXT NOT NULL DEFAULT 'inbox,pipeline,tasks,contacts,companies,settings,profile',
    "startRoute" TEXT NOT NULL DEFAULT '/inbox',
    "brandColor" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "mobile_layout_config_pkey" PRIMARY KEY ("id")
);
