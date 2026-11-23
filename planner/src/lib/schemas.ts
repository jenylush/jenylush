import { z } from "zod";
import { zs } from "./action";
import { NG_STATES } from "./phone";

export const addressSchema = z.object({
  street: zs.text(300),
  area: zs.text(120),
  city: zs.text(120),
  state: z.enum(NG_STATES, { errorMap: () => ({ message: "Choose a state" }) }),
  landmark: zs.optText(200),
  instructions: zs.optText(500),
});
