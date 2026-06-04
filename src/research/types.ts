export interface NewsItem {
  title: string
  source: string
  url: string
  publishedAt: string
}

export interface ResearchProvider {
  getRssHeadlines(feedUrl: string): Promise<NewsItem[]>
  searchGoogleNews(query: string): Promise<NewsItem[]>
  fetchPage(url: string): Promise<string>
}
