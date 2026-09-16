from collections import Counter

from app.curriculum_kg import load_curriculum_paths
from app.kg_catalog import CatalogEdge, CatalogNode, KGCatalog, load_kg_catalog
from app.kg_visualization import (
    aggregate_visual_edges,
    build_graph_integrity,
    load_categories,
    unique_relations,
)


EXPECTED_CATEGORY_COUNTS = {
    "program-foundations": 10,
    "types-and-values": 13,
    "collections-and-access": 16,
    "control-flow": 13,
    "functions-and-modules": 13,
    "errors-files-and-classes": 18,
}


def test_categories_assign_every_catalog_node_exactly_once():
    catalog = load_kg_catalog()
    categories = load_categories()

    assert len(categories) == 6
    assert [category.order for category in categories] == [1, 2, 3, 4, 5, 6]
    assert Counter(node.category_id for node in catalog.nodes.values()) == EXPECTED_CATEGORY_COUNTS
    assert all(node.category_id in EXPECTED_CATEGORY_COUNTS for node in catalog.nodes.values())


def test_category_visual_metadata_is_complete():
    categories = load_categories()

    assert [category.category_id for category in categories] == [
        "program-foundations",
        "types-and-values",
        "collections-and-access",
        "control-flow",
        "functions-and-modules",
        "errors-files-and-classes",
    ]
    for category in categories:
        assert category.label_zh
        assert category.label_en
        assert category.description_zh.endswith("。")
        assert category.color.startswith("#") and len(category.color) == 7
        assert category.surface_color.startswith("#") and len(category.surface_color) == 7
        assert 0 < category.anchor_x < 1
        assert 0 < category.anchor_y < 1


def test_unique_relations_and_visual_edges_have_exact_current_counts():
    catalog = load_kg_catalog()
    relations = unique_relations(catalog)
    visual_edges = aggregate_visual_edges(relations)

    assert len(catalog.edges) == 3500
    assert len(relations) == 367
    assert len(visual_edges) == 197
    assert sum(edge["relation_count"] for edge in visual_edges) == 367
    assert sum(relation["is_cross_category"] for relation in relations) == 55
    assert sum(not relation["is_cross_category"] for relation in relations) == 312


def test_integrity_report_is_valid_for_repository_graph():
    catalog = load_kg_catalog()
    categories = load_categories()
    relations = unique_relations(catalog)
    paths = load_curriculum_paths()

    report = build_graph_integrity(catalog, categories, relations, paths)

    assert report == {
        "valid": True,
        "uncategorized_node_ids": [],
        "duplicate_node_ids": [],
        "dangling_relation_keys": [],
        "duplicate_relation_keys": [],
        "invalid_path_ids": [],
    }


def test_relation_records_merge_sorted_provenance_and_visual_edges_by_direction():
    catalog = KGCatalog(
        nodes={
            "Concept:a": CatalogNode("Concept:a", "A", "Concept", "category-a"),
            "Concept:b": CatalogNode("Concept:b", "B", "Concept", "category-b"),
        },
        edges=[
            CatalogEdge(
                "Concept:a",
                "uses",
                "Concept:b",
                origin="generated",
                source_id="source-b",
                source_chunk_id="chunk-b",
                source_url="https://example.test/b",
                evidence_text="Evidence B",
            ),
            CatalogEdge(
                "Concept:a",
                "uses",
                "Concept:b",
                origin="curated",
                source_id="source-a",
                source_chunk_id="chunk-a",
                source_url="https://example.test/a",
                evidence_text="Evidence A",
            ),
            CatalogEdge("Concept:a", "requires", "Concept:b", origin="curated"),
        ],
    )

    relations = unique_relations(catalog)

    assert relations[1] == {
        "key": "Concept:a|uses|Concept:b",
        "source": "Concept:a",
        "type": "uses",
        "target": "Concept:b",
        "source_category_id": "category-a",
        "target_category_id": "category-b",
        "is_cross_category": True,
        "origins": ["curated", "generated"],
        "source_ids": ["source-a", "source-b"],
        "source_chunk_ids": ["chunk-a", "chunk-b"],
        "source_urls": ["https://example.test/a", "https://example.test/b"],
        "evidence_texts": ["Evidence A", "Evidence B"],
    }
    assert aggregate_visual_edges(relations) == [
        {
            "key": "Concept:a|Concept:b",
            "source": "Concept:a",
            "target": "Concept:b",
            "source_category_id": "category-a",
            "target_category_id": "category-b",
            "is_cross_category": True,
            "relation_types": ["requires", "uses"],
            "relation_count": 2,
            "provenance_count": 2,
            "origins": ["curated", "generated"],
            "source_ids": ["source-a", "source-b"],
            "source_chunk_ids": ["chunk-a", "chunk-b"],
            "source_urls": ["https://example.test/a", "https://example.test/b"],
            "evidence_texts": ["Evidence A", "Evidence B"],
        }
    ]
