import { AirwayTreatment, BreathingTreatment, MechanismOfInjury } from "@tccc/shared";

export const MECH: ReadonlyArray<readonly [string, MechanismOfInjury]> = [
  ["mechanism_artillery", MechanismOfInjury.ARTILLERY],
  ["mechanism_blunt", MechanismOfInjury.BLUNT],
  ["mechanism_burn", MechanismOfInjury.BURN],
  ["mechanism_fall", MechanismOfInjury.FALL],
  ["mechanism_grenade", MechanismOfInjury.GRENADE],
  ["mechanism_gsw", MechanismOfInjury.GSW],
  ["mechanism_ied", MechanismOfInjury.IED],
  ["mechanism_landmine", MechanismOfInjury.LANDMINE],
  ["mechanism_mvc", MechanismOfInjury.MVC],
  ["mechanism_rpg", MechanismOfInjury.RPG],
  ["mechanism_other", MechanismOfInjury.OTHER],
];

export const AIRWAY: ReadonlyArray<readonly [string, AirwayTreatment]> = [
  ["treatment_A_Intact", AirwayTreatment.INTACT],
  ["treatment_A_NPA", AirwayTreatment.NPA],
  ["treatment_A_CRIC", AirwayTreatment.CRIC],
  ["treatment_A_ET-Tube", AirwayTreatment.ET_TUBE],
  ["treatment_A_SGA", AirwayTreatment.SGA],
];

export const BREATHING: ReadonlyArray<readonly [string, BreathingTreatment]> = [
  ["treatment_B_O2", BreathingTreatment.O2],
  ["treatment_B_NeedleD", BreathingTreatment.NEEDLE_D],
  ["treatment_B_Chest-Tube", BreathingTreatment.CHEST_TUBE],
  ["treatment_B_ChestSeal", BreathingTreatment.CHEST_SEAL],
];

export const TQ_BOXES = ["treatment_C_TQ_Extremity", "treatment_C_TQ_Junctional", "treatment_C_TQ_Truncal"] as const;
