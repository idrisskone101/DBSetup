import { createClient } from '@supabase/supabase-js';

// Initialize Supabase client
const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

interface CanonicalMapping {
  [key: string]: string | string[];
}

// Canonicalization mappings based on user preferences
const genreMappings: CanonicalMapping = {
  'Science Fiction': 'science fiction',
  'Sci-Fi & Fantasy': ['science fiction', 'fantasy'],
  'Action & Adventure': ['action', 'adventure'],
  'War & Politics': ['war', 'politics'],
  'Action': 'action',
  'Adventure': 'adventure',
  'Animation': 'animation',
  'Comedy': 'comedy',
  'Crime': 'crime',
  'Documentary': 'documentary',
  'Drama': 'drama',
  'Family': 'family',
  'Fantasy': 'fantasy',
  'History': 'history',
  'Horror': 'horror',
  'Kids': 'kids',
  'Music': 'music',
  'Mystery': 'mystery',
  'News': 'news',
  'Reality': 'reality',
  'Romance': 'romance',
  'Soap': 'soap',
  'Talk': 'talk',
  'Thriller': 'thriller',
  'TV Movie': 'tv movie',
  'War': 'war',
  'Western': 'western',
};

const vibeMappings: CanonicalMapping = {
  // Hyphenation normalization
  'light-hearted': 'lighthearted',
  'light-hearted and adventurous': 'lighthearted and adventurous',
  'light-hearted and comedic': 'lighthearted and comedic',
  'light-hearted and dramatic': 'lighthearted and dramatic',
  'light-hearted and energetic': 'lighthearted and energetic',
  'light-hearted and humorous': 'lighthearted and humorous',
  'light-hearted and informative': 'lighthearted and informative',
  'light-hearted and playful': 'lighthearted and playful',
  'light-hearted and upbeat': 'lighthearted and upbeat',
  'light-hearted yet action-packed': 'lighthearted yet action-packed',
  'light-hearted yet adventurous': 'lighthearted yet adventurous',
  'light-hearted yet suspenseful': 'lighthearted yet suspenseful',

  // Dark comedy variations
  'darkly comic': 'darkly comedic',
  'dark comedy': 'darkly comedic',

  // Action-packed consolidation (moderate - keep specific combinations)
  'action-packed': 'action-packed',

  // Gothic variations
  'Gothic fantasy': 'gothic fantasy',
  'Gothic horror': 'gothic horror',

  // Case normalization for common duplicates
  '80s nostalgia': '1980s nostalgia',
  '80s neo-noir': '1980s neo-noir',
  '80s ski culture': '1980s ski culture',
  '1930s Southern Gothic': '1930s southern gothic',
};

const toneMappings: CanonicalMapping = {
  // Hyphenation normalization
  'light-hearted': 'lighthearted',
  'light-hearted and adventurous': 'lighthearted and adventurous',
  'light-hearted and comedic': 'lighthearted and comedic',
  'light-hearted and dramatic': 'lighthearted and dramatic',
  'light-hearted and energetic': 'lighthearted and energetic',
  'light-hearted and humorous': 'lighthearted and humorous',
  'light-hearted and informative': 'lighthearted and informative',
  'light-hearted and playful': 'lighthearted and playful',
  'light-hearted and upbeat': 'lighthearted and upbeat',
  'light-hearted yet action-packed': 'lighthearted yet action-packed',
  'light-hearted yet adventurous': 'lighthearted yet adventurous',
  'light-hearted yet suspenseful': 'lighthearted yet suspenseful',

  // Dark variations
  'darkly comic': 'darkly comedic',
};

const pacingMappings: CanonicalMapping = {
  'fast-paced': 'fast-paced',
  'slow-burn': 'slow-burn',
  'slow-burn with escalating tension': 'slow-burn with escalating tension',
};

const themeMappings: CanonicalMapping = {
  // Coming of age variations
  'coming of age': 'coming-of-age',
  'coming-of-age': 'coming-of-age',

  // Common duplicates (moderate approach)
  // Add more as needed based on analysis
};

/**
 * Canonicalize an array of values based on mapping
 */
function canonicalizeArray(values: string[] | null, mapping: CanonicalMapping): string[] {
  if (!values || values.length === 0) return [];

  const canonicalized = new Set<string>();

  for (const value of values) {
    const mapped = mapping[value];

    if (Array.isArray(mapped)) {
      // Split into multiple values
      mapped.forEach(v => canonicalized.add(v));
    } else if (mapped) {
      // Direct mapping
      canonicalized.add(mapped);
    } else {
      // No mapping, keep original but lowercase
      canonicalized.add(value.toLowerCase());
    }
  }

  return Array.from(canonicalized).sort();
}

/**
 * Canonicalize a single string value
 */
function canonicalizeString(value: string | null, mapping: CanonicalMapping): string | null {
  if (!value) return null;

  const mapped = mapping[value];

  if (Array.isArray(mapped)) {
    // If mapped to multiple values, just take the first
    return mapped[0];
  } else if (mapped) {
    return mapped;
  } else {
    // No mapping, lowercase
    return value.toLowerCase();
  }
}

/**
 * Generate SQL for batch update
 */
function generateBatchUpdateSQL(
  tableName: string,
  column: string,
  isArray: boolean,
  mapping: CanonicalMapping,
  offset: number,
  batchSize: number
): string {
  const caseStatements: string[] = [];

  if (isArray) {
    // For array columns, we need to build a CASE statement for array transformations
    // This is complex, so we'll do it in the application layer instead
    return '';
  } else {
    // For string columns
    for (const [oldValue, newValue] of Object.entries(mapping)) {
      if (typeof newValue === 'string') {
        caseStatements.push(`WHEN ${column} = '${oldValue.replace(/'/g, "''")}' THEN '${newValue.replace(/'/g, "''")}'`);
      }
    }

    const caseStatement = caseStatements.length > 0
      ? `CASE ${caseStatements.join(' ')} ELSE LOWER(${column}) END`
      : `LOWER(${column})`;

    return `
      UPDATE ${tableName}
      SET ${column} = ${caseStatement}
      WHERE id IN (
        SELECT id FROM ${tableName}
        ORDER BY id
        LIMIT ${batchSize} OFFSET ${offset}
      )
      AND ${column} IS NOT NULL;
    `;
  }
}

/**
 * Process array column canonicalization in application
 */
async function canonicalizeArrayColumn(
  tableName: string,
  column: string,
  mapping: CanonicalMapping,
  batchSize: number = 100
) {
  console.log(`\n🔄 Canonicalizing ${column} (array column)...`);

  let offset = 0;
  let processedCount = 0;
  let updatedCount = 0;

  while (true) {
    // Fetch batch
    const { data: rows, error } = await supabase
      .from(tableName)
      .select(`id, ${column}`)
      .not(column, 'is', null)
      .order('id')
      .range(offset, offset + batchSize - 1);

    if (error) {
      console.error(`❌ Error fetching batch: ${error.message}`);
      break;
    }

    if (!rows || rows.length === 0) {
      break;
    }

    // Process each row
    for (const row of rows) {
      const originalValues = row[column] as string[];
      const canonicalValues = canonicalizeArray(originalValues, mapping);

      // Only update if values changed
      if (JSON.stringify(originalValues.sort()) !== JSON.stringify(canonicalValues)) {
        const { error: updateError } = await supabase
          .from(tableName)
          .update({ [column]: canonicalValues })
          .eq('id', row.id);

        if (updateError) {
          console.error(`❌ Error updating row ${row.id}: ${updateError.message}`);
        } else {
          updatedCount++;
        }
      }

      processedCount++;
    }

    console.log(`  Processed ${processedCount} rows, updated ${updatedCount} rows...`);

    offset += batchSize;

    if (rows.length < batchSize) {
      break;
    }
  }

  console.log(`✅ Completed ${column}: ${updatedCount} rows updated out of ${processedCount} processed`);
  return { processed: processedCount, updated: updatedCount };
}

/**
 * Process string column canonicalization
 */
async function canonicalizeStringColumn(
  tableName: string,
  column: string,
  mapping: CanonicalMapping,
  batchSize: number = 100
) {
  console.log(`\n🔄 Canonicalizing ${column} (string column)...`);

  let offset = 0;
  let processedCount = 0;
  let updatedCount = 0;

  while (true) {
    // Fetch batch
    const { data: rows, error } = await supabase
      .from(tableName)
      .select(`id, ${column}`)
      .not(column, 'is', null)
      .order('id')
      .range(offset, offset + batchSize - 1);

    if (error) {
      console.error(`❌ Error fetching batch: ${error.message}`);
      break;
    }

    if (!rows || rows.length === 0) {
      break;
    }

    // Process each row
    for (const row of rows) {
      const originalValue = row[column] as string;
      const canonicalValue = canonicalizeString(originalValue, mapping);

      // Only update if value changed
      if (originalValue !== canonicalValue && canonicalValue !== null) {
        const { error: updateError } = await supabase
          .from(tableName)
          .update({ [column]: canonicalValue })
          .eq('id', row.id);

        if (updateError) {
          console.error(`❌ Error updating row ${row.id}: ${updateError.message}`);
        } else {
          updatedCount++;
        }
      }

      processedCount++;
    }

    console.log(`  Processed ${processedCount} rows, updated ${updatedCount} rows...`);

    offset += batchSize;

    if (rows.length < batchSize) {
      break;
    }
  }

  console.log(`✅ Completed ${column}: ${updatedCount} rows updated out of ${processedCount} processed`);
  return { processed: processedCount, updated: updatedCount };
}

/**
 * Get distinct values before canonicalization
 */
async function getDistinctValues(tableName: string, column: string, isArray: boolean): Promise<Set<string>> {
  const distinctValues = new Set<string>();

  if (isArray) {
    // For array columns, we need to unnest
    const { data, error } = await supabase.rpc('get_distinct_array_values', {
      table_name: tableName,
      column_name: column
    });

    // Fallback: fetch all and process in app
    const { data: rows } = await supabase
      .from(tableName)
      .select(column)
      .not(column, 'is', null);

    if (rows) {
      rows.forEach((row: any) => {
        const values = row[column] as string[];
        if (values) {
          values.forEach(v => distinctValues.add(v));
        }
      });
    }
  } else {
    // For string columns
    const { data: rows } = await supabase
      .from(tableName)
      .select(column)
      .not(column, 'is', null);

    if (rows) {
      rows.forEach((row: any) => {
        const value = row[column] as string;
        if (value) {
          distinctValues.add(value);
        }
      });
    }
  }

  return distinctValues;
}

/**
 * Main execution
 */
async function main() {
  console.log('🚀 Starting data canonicalization...\n');
  console.log('📊 Configuration:');
  console.log('  - Batch size: 100 records');
  console.log('  - Total expected records: ~1000');
  console.log('  - Case normalization: lowercase');
  console.log('  - Consolidation approach: moderate\n');

  const stats: Record<string, { before: number; after: number; updated: number }> = {};

  // 1. Genres (array)
  console.log('📋 Step 1/5: Processing genres...');
  const genresBefore = await getDistinctValues('titles', 'genres', true);
  const genresResult = await canonicalizeArrayColumn('titles', 'genres', genreMappings);
  const genresAfter = await getDistinctValues('titles', 'genres', true);
  stats.genres = { before: genresBefore.size, after: genresAfter.size, updated: genresResult.updated };

  // 2. Vibes (array)
  console.log('\n📋 Step 2/5: Processing vibes...');
  const vibesBefore = await getDistinctValues('titles', 'vibes', true);
  const vibesResult = await canonicalizeArrayColumn('titles', 'vibes', vibeMappings);
  const vibesAfter = await getDistinctValues('titles', 'vibes', true);
  stats.vibes = { before: vibesBefore.size, after: vibesAfter.size, updated: vibesResult.updated };

  // 3. Themes (array)
  console.log('\n📋 Step 3/5: Processing themes...');
  const themesBefore = await getDistinctValues('titles', 'themes', true);
  const themesResult = await canonicalizeArrayColumn('titles', 'themes', themeMappings);
  const themesAfter = await getDistinctValues('titles', 'themes', true);
  stats.themes = { before: themesBefore.size, after: themesAfter.size, updated: themesResult.updated };

  // 4. Tone (string)
  console.log('\n📋 Step 4/5: Processing tone...');
  const toneBefore = await getDistinctValues('titles', 'tone', false);
  const toneResult = await canonicalizeStringColumn('titles', 'tone', toneMappings);
  const toneAfter = await getDistinctValues('titles', 'tone', false);
  stats.tone = { before: toneBefore.size, after: toneAfter.size, updated: toneResult.updated };

  // 5. Pacing (string)
  console.log('\n📋 Step 5/5: Processing pacing...');
  const pacingBefore = await getDistinctValues('titles', 'pacing', false);
  const pacingResult = await canonicalizeStringColumn('titles', 'pacing', pacingMappings);
  const pacingAfter = await getDistinctValues('titles', 'pacing', false);
  stats.pacing = { before: pacingBefore.size, after: pacingAfter.size, updated: pacingResult.updated };

  // Print summary
  console.log('\n\n📊 CANONICALIZATION SUMMARY');
  console.log('=' .repeat(70));
  console.log('Column'.padEnd(15), 'Before'.padEnd(15), 'After'.padEnd(15), 'Rows Updated');
  console.log('-'.repeat(70));

  for (const [column, stat] of Object.entries(stats)) {
    console.log(
      column.padEnd(15),
      stat.before.toString().padEnd(15),
      stat.after.toString().padEnd(15),
      stat.updated.toString()
    );
  }

  console.log('=' .repeat(70));
  console.log('\n✅ Canonicalization complete!');
}

// Run if called directly
if (require.main === module) {
  main().catch(console.error);
}

export { main, canonicalizeArray, canonicalizeString };
