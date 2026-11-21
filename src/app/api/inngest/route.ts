import { serve } from "inngest/next";
import { inngest } from "@/workflows/client";
import { functionsA } from "@/workflows/a";
import { functionsB } from "@/workflows/b";
export const { GET, POST, PUT } = serve({ client: inngest, functions: [...functionsA, ...functionsB] });
