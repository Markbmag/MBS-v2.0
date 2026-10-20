SELECT q_customers.id AS id 
FROM q_customers 
WHERE lower(q_customers.name) LIKE lower('%50!%%') ESCAPE '!' ORDER BY `id` ASC 
 LIMIT 2000
