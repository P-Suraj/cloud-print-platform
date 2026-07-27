import 'dart:convert';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import '../models/shop.dart';

const String _favouriteKey = 'autoprint_favourite_shop';
const String _recentShopsKey = 'autoprint_recent_shops';

class ShopState {
  final Shop? favouriteShop;
  final List<Shop> recentShops;
  final bool isLoading;

  ShopState({
    this.favouriteShop,
    this.recentShops = const [],
    this.isLoading = false,
  });

  ShopState copyWith({
    Shop? favouriteShop,
    List<Shop>? recentShops,
    bool? isLoading,
  }) {
    return ShopState(
      favouriteShop: favouriteShop ?? this.favouriteShop,
      recentShops: recentShops ?? this.recentShops,
      isLoading: isLoading ?? this.isLoading,
    );
  }
}

class ShopNotifier extends StateNotifier<ShopState> {
  ShopNotifier() : super(ShopState()) {
    loadSavedShops();
  }

  Future<void> loadSavedShops() async {
    state = state.copyWith(isLoading: true);
    try {
      final prefs = await SharedPreferences.getInstance();

      // Load Favourite
      Shop? fav;
      final favRaw = prefs.getString(_favouriteKey);
      if (favRaw != null) {
        fav = Shop.fromJson(jsonDecode(favRaw));
      }

      // Load Recents
      final recentsRaw = prefs.getStringList(_recentShopsKey) ?? [];
      final List<Shop> recents = [];
      for (final item in recentsRaw) {
        try {
          recents.add(Shop.fromJson(jsonDecode(item)));
        } catch (_) {}
      }

      state = ShopState(
        favouriteShop: fav,
        recentShops: recents,
        isLoading: false,
      );
    } catch (_) {
      state = state.copyWith(isLoading: false);
    }
  }

  /// Parses raw QR scan or input string to extract shop_code (backwards compatible)
  String? parseShopCode(String rawValue) {
    final clean = rawValue.trim();
    // Existing URL format: https://domain/kiosk/TST001 or /shop/TST001
    final urlMatch = RegExp(r'/(?:kiosk|shop)/([A-Z0-9]+)', caseSensitive: false)
        .firstMatch(clean);
    if (urlMatch != null) return urlMatch.group(1)!.toUpperCase();

    // Future compact format: AUTOPRINT:TST001
    if (clean.toUpperCase().startsWith('AUTOPRINT:')) {
      return clean.split(':').last.toUpperCase();
    }

    // Plain code typed manually (e.g. TST001)
    if (RegExp(r'^[A-Z0-9]{3,12}$', caseSensitive: false).hasMatch(clean)) {
      return clean.toUpperCase();
    }

    return null;
  }

  /// Resolves shop_code to DB UUID and fetches metadata
  Future<Shop?> resolveShopCode(String shopCode) async {
    final cleanCode = shopCode.toUpperCase();
    try {
      // 1. Query by shop_code
      var response = await Supabase.instance.client
          .from('shops')
          .select('id, name, shop_code, last_seen_at, bw_slabs, color_slabs')
          .eq('shop_code', cleanCode)
          .maybeSingle();

      // 2. Fall back to querying by ID if it's a UUID
      if (response == null && RegExp(r'^[0-9a-f-]{36}$', caseSensitive: false).hasMatch(cleanCode)) {
        response = await Supabase.instance.client
            .from('shops')
            .select('id, name, shop_code, last_seen_at, bw_slabs, color_slabs')
            .eq('id', cleanCode)
            .maybeSingle();
      }

      if (response != null) {
        final shop = Shop.fromJson(response);
        await saveRecentShop(shop);
        return shop;
      }
    } catch (e) {
      print('Error resolving shop code: $e');
    }
    return null;
  }

  Future<void> setFavouriteShop(Shop shop) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_favouriteKey, jsonEncode(shop.toJson()));
    state = state.copyWith(favouriteShop: shop);
  }

  Future<void> removeFavouriteShop() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_favouriteKey);
    state = ShopState(
      favouriteShop: null,
      recentShops: state.recentShops,
      isLoading: false,
    );
  }

  Future<void> saveRecentShop(Shop shop) async {
    final prefs = await SharedPreferences.getInstance();
    final currentRecents = state.recentShops.where((s) => s.id != shop.id).toList();
    currentRecents.insert(0, shop);

    // Keep top 5
    final trimmed = currentRecents.take(5).toList();
    final rawList = trimmed.map((s) => jsonEncode(s.toJson())).toList();
    await prefs.setStringList(_recentShopsKey, rawList);

    state = state.copyWith(recentShops: trimmed);
  }
}

final shopProvider = StateNotifierProvider<ShopNotifier, ShopState>((ref) {
  return ShopNotifier();
});
