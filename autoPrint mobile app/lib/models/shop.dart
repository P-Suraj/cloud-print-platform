enum ShopStatus { ready, offline }

class Shop {
  final String id; // UUID — MUST use this for print_jobs.shop_id
  final String shopCode; // e.g. "TST001"
  final String name;
  final DateTime? lastSeenAt;
  final List<dynamic> bwSlabs;
  final List<dynamic> colorSlabs;

  Shop({
    required this.id,
    required this.shopCode,
    required this.name,
    this.lastSeenAt,
    this.bwSlabs = const [],
    this.colorSlabs = const [],
  });

  ShopStatus get status {
    if (lastSeenAt == null) return ShopStatus.offline;
    final diffSecs = DateTime.now().difference(lastSeenAt!).inSeconds;
    return diffSecs < 45 ? ShopStatus.ready : ShopStatus.offline;
  }

  String get statusLabel => switch (status) {
        ShopStatus.ready => '🟢 Ready',
        ShopStatus.offline => '🔴 Offline',
      };

  factory Shop.fromJson(Map<String, dynamic> json) {
    return Shop(
      id: json['id'] as String,
      shopCode: (json['shop_code'] as String? ?? '').toUpperCase(),
      name: json['name'] as String? ?? 'Print Shop',
      lastSeenAt: json['last_seen_at'] != null
          ? DateTime.tryParse(json['last_seen_at'] as String)
          : null,
      bwSlabs: json['bw_slabs'] as List<dynamic>? ?? [],
      colorSlabs: json['color_slabs'] as List<dynamic>? ?? [],
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'shop_code': shopCode,
      'name': name,
      'last_seen_at': lastSeenAt?.toIso8601String(),
      'bw_slabs': bwSlabs,
      'color_slabs': colorSlabs,
    };
  }
}
