SELECT q_orders.id AS id, q_orders.total / nullif(q_orders.qty, 0) AS per_item, CASE WHEN (q_orders.total >= 100) THEN 'big' ELSE 'small' END AS size, coalesce(q_orders.status, 'none') AS state, round(q_orders.total / nullif(3, 0), 2) AS third, concat(q_orders.status, '-', CAST(q_orders.id AS CHAR)) AS label, length(q_orders.status) AS name_len 
FROM q_orders ORDER BY `id` ASC 
 LIMIT 2000
