export interface Content {
  cid: number;
  type: 'post' | 'page';
  title: string;
  slug: string;
  text: string;
  summary: string;
  cover: string;
  status: 'publish' | 'draft' | 'hidden';
  template: string;
  sort_order: number;
  allow_comment: number;
  created: number;
  modified: number;
  comments?: number;
}

export interface Meta {
  mid: number;
  type: 'category' | 'tag';
  name: string;
  slug: string;
  description: string;
  sort_order: number;
  count?: number;
}

export interface Snapshot {
  generated: number;
  options: Record<string, string>;
  contents: Content[];
  metas: Meta[];
  relationships: [number, number][];
}
