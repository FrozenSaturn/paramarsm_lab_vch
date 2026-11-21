// Imports every handler module so each calls registerHandler(). A's handlers: ./handlers/a/*; B's: ./handlers/b/*
import "./handlers/a/send-email";
import "./handlers/a/send-whatsapp";
import "./handlers/a/erp-sheet";
