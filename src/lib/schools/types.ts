// Shared types for the school picker, which sources schools from two
// directories: South African high schools (checked into the repo as a JSON
// snapshot) and international universities (hipolabs API).

export type SchoolType = 'high_school' | 'university';

// One record of src/data/south-african-high-schools.json, produced by
// `npm run fetch:schools` walking api.labs.org.za.
export type HighSchoolRecord = {
  id: number | null;
  natEmis: string | null;
  name: string;
  province: string | null;
  town: string | null;
  phase: string | null;
};

// What the suggest endpoint and the SchoolPicker dropdown work with.
export type SchoolSuggestion = {
  name: string;
  type: SchoolType;
  // High schools only
  province?: string | null;
  town?: string | null;
  // Universities only
  country?: string | null;
  // nat_emis for high schools, primary domain for universities.
  externalId: string | null;
};

// A completed selection handed to the server actions.
export type PickedSchool = {
  name: string;
  type: SchoolType;
  externalId: string | null;
};

export function isSchoolType(value: unknown): value is SchoolType {
  return value === 'high_school' || value === 'university';
}
