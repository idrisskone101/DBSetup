/**
 * TMDB discovery functions
 * For discovering new titles from TMDB
 */

/**
 * Discover popular titles
 * @param {import("./client.js").TMDBClient} client
 * @param {"movie"|"tv"} kind
 * @param {Object} options
 * @param {number} [options.page=1] - Page number
 * @param {number} [options.minVotes=100] - Minimum vote count
 * @returns {Promise<{results: Array, totalPages: number, totalResults: number}>}
 */
export async function discoverPopular(client, kind, { page = 1, minVotes = 100 } = {}) {
  const params = {
    page,
    "vote_count.gte": minVotes,
    sort_by: "popularity.desc",
  };

  const response =
    kind === "movie" ? await client.discoverMovies(params) : await client.discoverTV(params);

  return {
    results: response.results || [],
    totalPages: response.total_pages || 0,
    totalResults: response.total_results || 0,
  };
}

/**
 * Discover titles by genre
 * @param {import("./client.js").TMDBClient} client
 * @param {"movie"|"tv"} kind
 * @param {number} genreId - TMDB genre ID
 * @param {Object} options
 * @param {number} [options.page=1] - Page number
 * @returns {Promise<{results: Array, totalPages: number, totalResults: number}>}
 */
export async function discoverByGenre(client, kind, genreId, { page = 1 } = {}) {
  const params = {
    page,
    with_genres: genreId,
    sort_by: "popularity.desc",
  };

  const response =
    kind === "movie" ? await client.discoverMovies(params) : await client.discoverTV(params);

  return {
    results: response.results || [],
    totalPages: response.total_pages || 0,
    totalResults: response.total_results || 0,
  };
}

/**
 * Discover titles by year
 * @param {import("./client.js").TMDBClient} client
 * @param {"movie"|"tv"} kind
 * @param {number} year - Release year
 * @param {Object} options
 * @param {number} [options.page=1] - Page number
 * @returns {Promise<{results: Array, totalPages: number, totalResults: number}>}
 */
export async function discoverByYear(client, kind, year, { page = 1 } = {}) {
  const params = {
    page,
    sort_by: "popularity.desc",
  };

  if (kind === "movie") {
    params.primary_release_year = year;
  } else {
    params.first_air_date_year = year;
  }

  const response =
    kind === "movie" ? await client.discoverMovies(params) : await client.discoverTV(params);

  return {
    results: response.results || [],
    totalPages: response.total_pages || 0,
    totalResults: response.total_results || 0,
  };
}

/**
 * Iterate through all pages of a discovery query
 * @param {import("./client.js").TMDBClient} client
 * @param {"movie"|"tv"} kind
 * @param {Function} discoverFn - Discovery function to use
 * @param {Object} options
 * @param {number} [options.maxPages=100] - Maximum pages to fetch
 * @param {number} [options.maxResults=10000] - Maximum results to return
 * @param {Function} [options.onPage] - Callback after each page
 * @returns {AsyncGenerator<Object>}
 */
export async function* discoverAll(client, kind, discoverFn, options = {}) {
  const { maxPages = 100, maxResults = 10000, onPage } = options;

  let page = 1;
  let totalYielded = 0;

  while (page <= maxPages && totalYielded < maxResults) {
    const response = await discoverFn(client, kind, { ...options, page });

    if (onPage) {
      onPage(page, response.totalPages, response.results.length);
    }

    for (const item of response.results) {
      if (totalYielded >= maxResults) break;
      yield item;
      totalYielded++;
    }

    if (page >= response.totalPages) break;
    page++;
  }
}
