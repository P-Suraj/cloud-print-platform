import 'package:flutter/material.dart';
import '../models/shop.dart';

class ShopCard extends StatelessWidget {
  final Shop shop;
  final bool isFavourite;
  final VoidCallback onTap;
  final VoidCallback? onFavouriteToggle;

  const ShopCard({
    super.key,
    required this.shop,
    required this.onTap,
    this.isFavourite = false,
    this.onFavouriteToggle,
  });

  @override
  Widget build(BuildContext context) {
    final isOnline = shop.status == ShopStatus.ready;

    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(12),
      child: Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: const Color(0xFF1A1A22),
          borderRadius: BorderRadius.circular(12),
          border: Border.all(
            color: isFavourite ? const Color(0xFF6366F1) : const Color(0xFF2A2A36),
            width: isFavourite ? 1.5 : 1,
          ),
        ),
        child: Row(
          children: [
            Container(
              width: 42,
              height: 42,
              decoration: BoxDecoration(
                color: const Color(0xFF6366F1).withValues(alpha: 0.15),
                borderRadius: BorderRadius.circular(10),
              ),
              child: const Icon(Icons.storefront_rounded, color: Color(0xFF6366F1), size: 22),
            ),
            const SizedBox(width: 14),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          shop.name,
                          style: const TextStyle(
                            color: Colors.white,
                            fontWeight: FontWeight.bold,
                            fontSize: 15,
                          ),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                      Text(
                        shop.statusLabel,
                        style: TextStyle(
                          color: isOnline ? const Color(0xFF10B981) : const Color(0xFFEF4444),
                          fontWeight: FontWeight.w600,
                          fontSize: 12,
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 4),
                  Text(
                    'Code: ${shop.shopCode}',
                    style: const TextStyle(
                      color: Color(0xFF9CA3AF),
                      fontSize: 12,
                    ),
                  ),
                ],
              ),
            ),
            if (onFavouriteToggle != null) ...[
              const SizedBox(width: 8),
              IconButton(
                icon: Icon(
                  isFavourite ? Icons.star_rounded : Icons.star_outline_rounded,
                  color: isFavourite ? const Color(0xFFF59E0B) : const Color(0xFF6B7280),
                ),
                onPressed: onFavouriteToggle,
              ),
            ],
          ],
        ),
      ),
    );
  }
}
