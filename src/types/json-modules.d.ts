// Typed import for the high-school snapshot. Declaring the module ambiently
// stops TypeScript from inferring a literal type for the ~8800-record JSON
// (which is slow to typecheck); the bundler still resolves the real file.
declare module '@/data/south-african-high-schools.json' {
  const directory: {
    source: string;
    fetchedAt: string;
    total: number;
    schools: import('../lib/schools/types').HighSchoolRecord[];
  };
  export default directory;
}
