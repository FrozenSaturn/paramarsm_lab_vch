// Imports every handler module so each calls registerHandler(). A's handlers: ./handlers/a/*; B's: ./handlers/b/*
import "./handlers/a/dev";
import "./handlers/a/send-email";
import "./handlers/b/notify-hod";
import "./handlers/b/performance-record";
