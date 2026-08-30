use std::{
    cmp::Ordering,
    collections::{HashMap, HashSet},
};

use serde::{Deserialize, Serialize};

const FAMILY_PROCESSING_MULTIPLIER: usize = 10;

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DuplicateJsxAnalysisInput {
    pub candidates: Vec<DuplicateJsxCandidateInput>,
    pub minimum_node_count: usize,
    pub minimum_depth: usize,
    pub minimum_occurrences: usize,
    pub minimum_distinct_files: usize,
    pub max_families: usize,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DuplicateJsxCandidateInput {
    pub fingerprint: String,
    pub fingerprint_sort_index: usize,
    pub node_count: usize,
    pub depth: usize,
    pub occurrence: DuplicateJsxOccurrence,
}

#[derive(Debug, Clone, Eq, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DuplicateJsxOccurrence {
    pub path: String,
    #[serde(skip_serializing)]
    pub path_sort_index: usize,
    pub start_offset: usize,
    pub end_offset: usize,
    pub start_line: usize,
    pub start_column: usize,
    pub end_line: usize,
    pub end_column: usize,
    pub root_name: String,
    pub parent_root_name: Option<String>,
    pub composition_path: Vec<String>,
    pub composition_root_start_offset: Option<usize>,
}

#[derive(Debug, Clone, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DuplicateJsxFamily {
    pub fingerprint: String,
    #[serde(skip_serializing)]
    fingerprint_sort_index: usize,
    pub node_count: usize,
    pub depth: usize,
    pub occurrence_count: usize,
    pub distinct_file_count: usize,
    pub estimated_removable_node_count: usize,
    pub estimated_removable_line_count: usize,
    pub primary_occurrence: DuplicateJsxOccurrence,
    pub related_occurrences: Vec<DuplicateJsxOccurrence>,
}

struct DuplicateJsxBucket {
    fingerprint: String,
    fingerprint_sort_index: usize,
    node_count: usize,
    depth: usize,
    occurrences: Vec<DuplicateJsxOccurrence>,
}

pub fn analyze_duplicate_jsx(input: &DuplicateJsxAnalysisInput) -> Vec<DuplicateJsxFamily> {
    let mut bucket_index_by_fingerprint = HashMap::<&str, usize>::new();
    let mut buckets = Vec::<DuplicateJsxBucket>::new();
    for candidate in &input.candidates {
        if candidate.node_count < input.minimum_node_count || candidate.depth < input.minimum_depth
        {
            continue;
        }
        if let Some(bucket_index) = bucket_index_by_fingerprint.get(candidate.fingerprint.as_str())
        {
            buckets[*bucket_index]
                .occurrences
                .push(candidate.occurrence.clone());
            continue;
        }
        bucket_index_by_fingerprint.insert(candidate.fingerprint.as_str(), buckets.len());
        buckets.push(DuplicateJsxBucket {
            fingerprint: candidate.fingerprint.clone(),
            fingerprint_sort_index: candidate.fingerprint_sort_index,
            node_count: candidate.node_count,
            depth: candidate.depth,
            occurrences: vec![candidate.occurrence.clone()],
        });
    }

    let family_processing_limit = input
        .max_families
        .saturating_mul(FAMILY_PROCESSING_MULTIPLIER)
        .max(input.max_families.saturating_add(1));
    let mut families = Vec::<DuplicateJsxFamily>::new();
    for mut bucket in buckets {
        if bucket.occurrences.len() < input.minimum_occurrences {
            continue;
        }
        bucket.occurrences.sort_by(compare_occurrences);
        let distinct_file_count = bucket
            .occurrences
            .iter()
            .map(|occurrence| occurrence.path.as_str())
            .collect::<HashSet<_>>()
            .len();
        if distinct_file_count < input.minimum_distinct_files {
            continue;
        }
        if distinct_file_count == 1 {
            let composition_root_count = bucket
                .occurrences
                .iter()
                .filter_map(|occurrence| occurrence.composition_root_start_offset)
                .collect::<HashSet<_>>()
                .len();
            if composition_root_count < 2 {
                continue;
            }
        }
        let occurrence_count = bucket.occurrences.len();
        let total_line_count = bucket
            .occurrences
            .iter()
            .map(occurrence_line_count)
            .fold(0usize, usize::saturating_add);
        let largest_occurrence_line_count = bucket
            .occurrences
            .iter()
            .map(occurrence_line_count)
            .max()
            .unwrap_or(0);
        let primary_occurrence = bucket.occurrences.remove(0);
        families.push(DuplicateJsxFamily {
            fingerprint: bucket.fingerprint,
            fingerprint_sort_index: bucket.fingerprint_sort_index,
            node_count: bucket.node_count,
            depth: bucket.depth,
            occurrence_count,
            distinct_file_count,
            estimated_removable_node_count: bucket
                .node_count
                .saturating_mul(occurrence_count.saturating_sub(1)),
            estimated_removable_line_count: total_line_count
                .saturating_sub(largest_occurrence_line_count),
            primary_occurrence,
            related_occurrences: bucket.occurrences,
        });
        if families.len() > family_processing_limit {
            break;
        }
    }

    families.sort_by(|left, right| {
        right
            .node_count
            .cmp(&left.node_count)
            .then_with(|| right.depth.cmp(&left.depth))
    });
    let mut maximal_families = Vec::<DuplicateJsxFamily>::new();
    for family in families {
        if maximal_families
            .iter()
            .any(|outer_family| family_is_nested_within(&family, outer_family))
        {
            continue;
        }
        maximal_families.push(family);
    }
    maximal_families.sort_by(compare_families);
    maximal_families.truncate(input.max_families);
    maximal_families
}

fn occurrence_line_count(occurrence: &DuplicateJsxOccurrence) -> usize {
    occurrence
        .end_line
        .saturating_sub(occurrence.start_line)
        .saturating_add(1)
}

fn compare_occurrences(left: &DuplicateJsxOccurrence, right: &DuplicateJsxOccurrence) -> Ordering {
    left.path_sort_index
        .cmp(&right.path_sort_index)
        .then_with(|| left.start_offset.cmp(&right.start_offset))
        .then_with(|| left.end_offset.cmp(&right.end_offset))
}

fn compare_families(left: &DuplicateJsxFamily, right: &DuplicateJsxFamily) -> Ordering {
    right
        .estimated_removable_node_count
        .cmp(&left.estimated_removable_node_count)
        .then_with(|| {
            right
                .estimated_removable_line_count
                .cmp(&left.estimated_removable_line_count)
        })
        .then_with(|| right.occurrence_count.cmp(&left.occurrence_count))
        .then_with(|| right.distinct_file_count.cmp(&left.distinct_file_count))
        .then_with(|| right.node_count.cmp(&left.node_count))
        .then_with(|| compare_occurrences(&left.primary_occurrence, &right.primary_occurrence))
        .then_with(|| {
            left.fingerprint_sort_index
                .cmp(&right.fingerprint_sort_index)
        })
}

fn occurrence_is_contained(inner: &DuplicateJsxOccurrence, outer: &DuplicateJsxOccurrence) -> bool {
    inner.path == outer.path
        && inner.start_offset >= outer.start_offset
        && inner.end_offset <= outer.end_offset
}

fn family_is_nested_within(candidate: &DuplicateJsxFamily, outer: &DuplicateJsxFamily) -> bool {
    family_occurrences(candidate).all(|candidate_occurrence| {
        family_occurrences(outer)
            .any(|outer_occurrence| occurrence_is_contained(candidate_occurrence, outer_occurrence))
    })
}

fn family_occurrences(
    family: &DuplicateJsxFamily,
) -> impl Iterator<Item = &DuplicateJsxOccurrence> {
    std::iter::once(&family.primary_occurrence).chain(family.related_occurrences.iter())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn occurrence(
        path: &str,
        path_sort_index: usize,
        start_offset: usize,
    ) -> DuplicateJsxOccurrence {
        DuplicateJsxOccurrence {
            path: path.to_string(),
            path_sort_index,
            start_offset,
            end_offset: start_offset + 20,
            start_line: start_offset + 1,
            start_column: 1,
            end_line: start_offset + 3,
            end_column: 2,
            root_name: "section".to_string(),
            parent_root_name: None,
            composition_path: vec!["Card".to_string(), "section".to_string()],
            composition_root_start_offset: Some(start_offset),
        }
    }

    fn candidate(
        fingerprint: &str,
        fingerprint_sort_index: usize,
        node_count: usize,
        depth: usize,
        occurrence: DuplicateJsxOccurrence,
    ) -> DuplicateJsxCandidateInput {
        DuplicateJsxCandidateInput {
            fingerprint: fingerprint.to_string(),
            fingerprint_sort_index,
            node_count,
            depth,
            occurrence,
        }
    }

    fn options(candidates: Vec<DuplicateJsxCandidateInput>) -> DuplicateJsxAnalysisInput {
        DuplicateJsxAnalysisInput {
            candidates,
            minimum_node_count: 6,
            minimum_depth: 3,
            minimum_occurrences: 2,
            minimum_distinct_files: 1,
            max_families: 20,
        }
    }

    #[test]
    fn groups_candidates_and_preserves_canonical_occurrence_order() {
        let input = options(vec![
            candidate("tree", 0, 7, 3, occurrence("src/b.tsx", 1, 30)),
            candidate("tree", 0, 7, 3, occurrence("src/a.tsx", 0, 10)),
        ]);

        let families = analyze_duplicate_jsx(&input);

        assert_eq!(families.len(), 1);
        assert_eq!(families[0].primary_occurrence.path, "src/a.tsx");
        assert_eq!(families[0].related_occurrences[0].path, "src/b.tsx");
        assert_eq!(families[0].estimated_removable_node_count, 7);
        assert_eq!(families[0].estimated_removable_line_count, 3);
    }

    #[test]
    fn requires_distinct_composition_roots_for_one_file() {
        let mut first = occurrence("src/cards.tsx", 0, 10);
        first.composition_root_start_offset = Some(1);
        let mut repeated_sibling = occurrence("src/cards.tsx", 0, 40);
        repeated_sibling.composition_root_start_offset = Some(1);
        let sibling_input = options(vec![
            candidate("tree", 0, 7, 3, first),
            candidate("tree", 0, 7, 3, repeated_sibling),
        ]);
        assert!(analyze_duplicate_jsx(&sibling_input).is_empty());

        let distinct_root_input = options(vec![
            candidate("tree", 0, 7, 3, occurrence("src/cards.tsx", 0, 10)),
            candidate("tree", 0, 7, 3, occurrence("src/cards.tsx", 0, 40)),
        ]);
        assert_eq!(analyze_duplicate_jsx(&distinct_root_input).len(), 1);
    }

    #[test]
    fn suppresses_nested_families_and_ranks_by_removable_nodes() {
        let mut outer_a = occurrence("src/a.tsx", 0, 0);
        outer_a.end_offset = 100;
        let mut outer_b = occurrence("src/b.tsx", 1, 0);
        outer_b.end_offset = 100;
        let mut input = options(vec![
            candidate("outer", 1, 8, 4, outer_a),
            candidate("inner", 0, 6, 3, occurrence("src/a.tsx", 0, 5)),
            candidate("outer", 1, 8, 4, outer_b),
            candidate("inner", 0, 6, 3, occurrence("src/b.tsx", 1, 5)),
            candidate("frequent", 2, 7, 3, occurrence("src/c.tsx", 2, 0)),
            candidate("frequent", 2, 7, 3, occurrence("src/d.tsx", 3, 0)),
            candidate("frequent", 2, 7, 3, occurrence("src/e.tsx", 4, 0)),
        ]);
        input.max_families = 2;

        let families = analyze_duplicate_jsx(&input);

        assert_eq!(
            families
                .iter()
                .map(|family| family.fingerprint.as_str())
                .collect::<Vec<_>>(),
            ["frequent", "outer"]
        );
    }

    #[test]
    fn preserves_the_camel_case_json_boundary() {
        let input = serde_json::from_str::<DuplicateJsxAnalysisInput>(
            r#"{
                "candidates": [],
                "minimumNodeCount": 6,
                "minimumDepth": 3,
                "minimumOccurrences": 2,
                "minimumDistinctFiles": 1,
                "maxFamilies": 20
            }"#,
        )
        .unwrap();

        assert_eq!(
            serde_json::to_value(analyze_duplicate_jsx(&input)).unwrap(),
            serde_json::json!([])
        );
    }
}
