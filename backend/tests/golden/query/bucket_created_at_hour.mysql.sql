SELECT date_add(date(q_orders.created_at), INTERVAL hour(q_orders.created_at) HOUR) AS period, count(*) AS n 
FROM q_orders GROUP BY date_add(date(q_orders.created_at), INTERVAL hour(q_orders.created_at) HOUR) ORDER BY `period` ASC 
 LIMIT 2000
