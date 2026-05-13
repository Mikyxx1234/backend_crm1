-- Painel Lead na Inbox: quais campos personalizados de contato o agente vê
ALTER TABLE "custom_fields" ADD COLUMN "showInInboxLeadPanel" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "custom_fields" ADD COLUMN "inboxLeadPanelOrder" INTEGER;
